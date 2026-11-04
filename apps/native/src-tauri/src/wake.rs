//! Wake-on-LAN. Magic-packet construction and sending are shared by the Mac (tests, diagnostics) and the
//! iPhone. Gathering the Mac's own interface details is macOS only. A fully asleep Mac cannot be reached
//! from the internet; see the "Wake Mac from iPhone" section of docs/spec.md for the physical limits.
#![allow(dead_code)] // sending is used by phone builds, gathering by Mac builds
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};

/// One Mac network interface the phone may try to wake.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WakeTarget {
    pub interface: String,
    /// Hardware (burned-in) MAC, lower-case `aa:bb:cc:dd:ee:ff`. Not Wi-Fi's rotating private address.
    pub mac: String,
    pub ip: Option<String>,
    pub broadcast: Option<String>,
}
/// What the Mac reports to a paired phone.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WakeInfo {
    pub targets: Vec<WakeTarget>,
    /// `pmset womp`: None when it could not be read.
    pub wake_for_network: Option<bool>,
}

pub fn parse_mac(text: &str) -> Result<[u8; 6], String> {
    let parts: Vec<&str> = text.trim().split([':', '-']).collect();
    if parts.len() != 6 { return Err(format!("Invalid MAC address: {text}")); }
    let mut mac = [0u8; 6];
    for (slot, part) in mac.iter_mut().zip(parts) {
        if part.is_empty() || part.len() > 2 { return Err(format!("Invalid MAC address: {text}")); }
        *slot = u8::from_str_radix(part, 16).map_err(|_| format!("Invalid MAC address: {text}"))?;
    }
    if mac == [0; 6] || mac == [0xff; 6] { return Err(format!("Invalid MAC address: {text}")); }
    Ok(mac)
}
pub fn format_mac(mac: [u8; 6]) -> String {
    mac.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":")
}
/// 6 bytes of 0xFF followed by the target MAC repeated 16 times (102 bytes).
pub fn magic_packet(mac: [u8; 6]) -> [u8; 102] {
    let mut packet = [0xffu8; 102];
    for i in 0..16 { packet[6 + i * 6..12 + i * 6].copy_from_slice(&mac); }
    packet
}
/// Addresses a magic packet is sent to: the Mac's directed broadcast, the limited broadcast and its last-known IP.
pub fn destinations(target: &WakeTarget) -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    for text in [target.broadcast.as_deref(), Some("255.255.255.255"), target.ip.as_deref()].into_iter().flatten() {
        if let Ok(ip) = text.parse::<Ipv4Addr>() { if !out.contains(&ip) { out.push(ip); } }
    }
    out
}
/// Sends magic packets (UDP port 9) for every target. Returns how many datagrams were sent. Any send failure
/// is reported with its destination: iOS blocks broadcast without a local-network permission/entitlement, and
/// the user must be told rather than shown a false "sent".
pub fn send(info: &WakeInfo) -> Result<usize, String> {
    if info.targets.is_empty() { return Err("No wake details saved for your Mac yet. Connect to it once on its Wi-Fi or Ethernet network.".into()); }
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("Cannot open a network socket: {e}"))?;
    socket.set_broadcast(true).map_err(|e| format!("Cannot enable broadcast: {e}"))?;
    let (mut sent, mut failures) = (0usize, Vec::new());
    for target in &info.targets {
        let packet = magic_packet(parse_mac(&target.mac)?);
        for ip in destinations(target) {
            match socket.send_to(&packet, SocketAddr::from((ip, 9))) {
                Ok(_) => sent += 1,
                Err(e) => failures.push(format!("{ip}: {e}")),
            }
        }
    }
    if sent == 0 { return Err(format!("Could not send the wake signal ({}). Check that Freddai may use the local network in iPhone Settings.", failures.join("; "))); }
    if !failures.is_empty() { eprintln!("wake: partial send failures: {}", failures.join("; ")); }
    Ok(sent)
}
/// Pure parse of `pmset -g` output.
pub fn parse_womp(pmset: &str) -> Option<bool> {
    pmset.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        if words.next()? != "womp" { return None; }
        match words.next()? { "1" => Some(true), "0" => Some(false), _ => None }
    })
}
pub fn parse_wake_info(value: &Value) -> Result<WakeInfo, String> {
    serde_json::from_value(value.clone()).map_err(|_| "Invalid wake details from your Mac".to_string())
}

#[cfg(target_os = "macos")]
pub mod mac {
    use super::*;
    use std::process::Command;
    fn run(program: &str, args: &[&str]) -> Result<String, String> {
        let out = Command::new(program).args(args).output().map_err(|e| format!("{program}: {e}"))?;
        if !out.status.success() { return Err(format!("{program} exited with {}", out.status)); }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }
    /// `networksetup -listallhardwareports` -> (device, hardware MAC).
    pub fn parse_hardware_ports(text: &str) -> Vec<(String, String)> {
        let (mut device, mut out) = (None::<String>, Vec::new());
        for line in text.lines() {
            if let Some(d) = line.strip_prefix("Device:") { device = Some(d.trim().to_string()); }
            else if let Some(m) = line.strip_prefix("Ethernet Address:") {
                if let (Some(d), Ok(mac)) = (device.take(), parse_mac(m)) { out.push((d, format_mac(mac))); }
            }
        }
        out
    }
    /// `ifconfig <if>` -> (ipv4, broadcast) of the first inet line.
    pub fn parse_ifconfig_inet(text: &str) -> Option<(String, Option<String>)> {
        text.lines().find_map(|line| {
            let words: Vec<&str> = line.split_whitespace().collect();
            if words.first() != Some(&"inet") { return None; }
            let ip = words.get(1)?.to_string();
            let broadcast = words.iter().position(|w| *w == "broadcast").and_then(|i| words.get(i + 1)).map(|s| s.to_string());
            Some((ip, broadcast))
        })
    }
    pub fn parse_default_interface(text: &str) -> Option<String> {
        text.lines().find_map(|l| l.trim().strip_prefix("interface:").map(|s| s.trim().to_string()))
    }
    pub fn womp() -> Option<bool> { run("/usr/bin/pmset", &["-g"]).ok().and_then(|t| parse_womp(&t)) }
    /// Primary (default-route) interface first, then other active interfaces that have an IPv4 address.
    pub fn collect() -> Result<WakeInfo, String> {
        let ports = parse_hardware_ports(&run("/usr/sbin/networksetup", &["-listallhardwareports"])?);
        let primary = run("/sbin/route", &["-n", "get", "default"]).ok().and_then(|t| parse_default_interface(&t));
        let mut targets = Vec::new();
        for (device, mac) in ports {
            let Some((ip, broadcast)) = run("/sbin/ifconfig", &[&device]).ok().and_then(|t| parse_ifconfig_inet(&t)) else { continue };
            if ip.starts_with("169.254.") { continue; }
            let target = WakeTarget { interface: device.clone(), mac, ip: Some(ip), broadcast };
            if primary.as_deref() == Some(device.as_str()) { targets.insert(0, target); } else { targets.push(target); }
        }
        if targets.is_empty() { return Err("No active network interface with a hardware address was found".into()); }
        Ok(WakeInfo { targets, wake_for_network: womp() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn magic_packet_is_six_ff_then_sixteen_macs() {
        let mac = parse_mac("AA:bb:0c:0D:ee:01").unwrap();
        let p = magic_packet(mac);
        assert_eq!(p.len(), 102);
        assert!(p[..6].iter().all(|b| *b == 0xff));
        for i in 0..16 { assert_eq!(&p[6 + i * 6..12 + i * 6], &mac); }
    }
    #[test]
    fn mac_parsing_rejects_bad_input() {
        for bad in ["", "aa:bb", "aa:bb:cc:dd:ee:gg", "00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "aa:bb:cc:dd:ee:ff:00", "aaa:bb:cc:dd:ee:ff"] { assert!(parse_mac(bad).is_err(), "{bad}"); }
        assert_eq!(format_mac(parse_mac("A-B-C-D-E-F").unwrap()), "0a:0b:0c:0d:0e:0f");
    }
    #[test]
    fn destinations_are_deduplicated_and_skip_garbage() {
        let t = WakeTarget { interface: "en0".into(), mac: "aa:bb:cc:dd:ee:ff".into(), ip: Some("192.168.1.5".into()), broadcast: Some("192.168.1.255".into()) };
        assert_eq!(destinations(&t), vec!["192.168.1.255".parse::<Ipv4Addr>().unwrap(), "255.255.255.255".parse().unwrap(), "192.168.1.5".parse().unwrap()]);
        let t = WakeTarget { broadcast: Some("255.255.255.255".into()), ip: Some("nope".into()), ..t };
        assert_eq!(destinations(&t).len(), 1);
    }
    #[test]
    fn send_requires_targets_and_delivers_the_packet() {
        assert!(send(&WakeInfo::default()).unwrap_err().contains("No wake details"));
        // Port 9 cannot be bound unprivileged, so verify only that a loopback send succeeds.
        let info = WakeInfo { targets: vec![WakeTarget { interface: "lo0".into(), mac: "aa:bb:cc:dd:ee:ff".into(), ip: Some("127.0.0.1".into()), broadcast: None }], wake_for_network: None };
        assert!(send(&info).unwrap() >= 1);
    }
    #[test]
    fn womp_parsing() {
        assert_eq!(parse_womp("Currently in use:\n womp                 1\n sleep 1"), Some(true));
        assert_eq!(parse_womp(" womp 0"), Some(false));
        assert_eq!(parse_womp("sleep 1"), None);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn mac_output_parsers() {
        let ports = "Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 3C:22:FB:01:02:03\n\nHardware Port: Thunderbolt\nDevice: bridge0\nEthernet Address: N/A\n";
        assert_eq!(mac::parse_hardware_ports(ports), vec![("en0".to_string(), "3c:22:fb:01:02:03".to_string())]);
        assert_eq!(mac::parse_ifconfig_inet("\tinet6 fe80::1\n\tinet 192.168.146.213 netmask 0xffffff00 broadcast 192.168.146.255\n"), Some(("192.168.146.213".into(), Some("192.168.146.255".into()))));
        assert_eq!(mac::parse_default_interface("   route to: default\n  interface: en0\n"), Some("en0".into()));
    }
}
