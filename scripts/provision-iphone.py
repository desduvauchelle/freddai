#!/usr/bin/env python3
"""Provision this Mac's companion identity without printing or committing secrets."""
import json, os, secrets, subprocess
from pathlib import Path
root = Path.home() / 'Library/Application Support/com.freddai.desktop/companion'
root.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(root, 0o700)
host = subprocess.check_output(['scutil', '--get', 'LocalHostName'], text=True).strip() + '.local'
if not (root / 'ca.crt').exists() or 'subjectKeyIdentifier' not in (root / 'ca.cnf').read_text():
    ca_config = root / 'ca.cnf'
    ca_config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Freddai Companion Private CA\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n')
    config = root / 'openssl.cnf'
    config.write_text('[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=' + host + '\n[ext]\nsubjectAltName=DNS:' + host + '\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    def openssl(*args):
        subprocess.run(['/usr/bin/openssl', *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-config', str(ca_config), '-keyout', str(root / 'ca.key'), '-out', str(root / 'ca.crt'))
    openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-config', str(config), '-keyout', str(root / 'server.key'), '-out', str(root / 'server.csr'))
    openssl('x509', '-req', '-in', str(root / 'server.csr'), '-CA', str(root / 'ca.crt'), '-CAkey', str(root / 'ca.key'), '-CAcreateserial', '-days', '365', '-extfile', str(config), '-extensions', 'ext', '-out', str(root / 'server.crt'))
    with (root / 'server.crt').open('a') as f: f.write((root / 'ca.crt').read_text())
    for name in ['ca.key', 'server.key']: os.chmod(root / name, 0o600)
provision = root / 'iphone-provision.json'
fd = os.open(provision, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as f:
    json.dump({'endpoint': 'https://' + host + ':49744', 'certificate': (root / 'ca.crt').read_text()}, f)
print(str(provision))
