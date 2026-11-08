# Linux installation

Freddai requires x86-64 Linux and your own installed coding-agent CLI and provider account.

## Omarchy / Arch Linux

Use **Freddai-linux-x64.tar.gz**, not the Debian package. Extract the archive in your file manager. It contains the AppImage with executable permissions preserved, plus this guide.

Open a terminal in the extracted `Freddai-linux-x64` folder and run:

```sh
./Freddai-linux-x64.AppImage
```

If you downloaded the standalone AppImage instead, open a terminal in Downloads and run:

```sh
chmod +x Freddai-linux-x64.AppImage
./Freddai-linux-x64.AppImage
```

The message “There is no app installed for AppImage application bundle files” comes from the file manager before Freddai starts. An AppImage is an executable, not a document to open in another app. Browser downloads normally lose the executable permission. Some file managers still require launching from a terminal even after setting it.

### FUSE errors

If terminal output says `libfuse.so.2` is missing or that FUSE is required, install Arch's FUSE 2 compatibility package:

```sh
sudo pacman -S fuse2
```

Alternatively, run without FUSE by extracting into a new folder (do not reuse an existing `squashfs-root`):

```sh
mkdir freddai-extracted
cd freddai-extracted
../Freddai-linux-x64.AppImage --appimage-extract
./squashfs-root/AppRun
```

Keep the original AppImage to use AppImage updates; the extracted fallback does not update itself. If a different error appears, copy the terminal output when reporting it. Do not run Freddai with sudo.

## Debian / Ubuntu

Use **Freddai-linux-x64.deb**. From a terminal in Downloads:

```sh
sudo apt install ./Freddai-linux-x64.deb
freddai-native
```

Debian packages are not an Omarchy/Arch installer. Debian installations update by downloading a newer package.

See [AppImage's launch instructions](https://docs.appimage.org/introduction/quickstart.html) and [FUSE troubleshooting](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).
