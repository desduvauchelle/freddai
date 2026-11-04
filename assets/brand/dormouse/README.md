# Freddai dormouse artwork

## Selected: v3, smaller body

Denis selected the smaller-body v3 after comparing it with v4. `dormouse.svg` and `dormouse-icon.svg` are the current selected assets, byte-identical to their v3 counterparts. The generator defaults to v3. The larger-body v4 remains an archived alternative.

The local Rive project in `rive/` reads the selected v3 geometry and adds animation states inspired by Tucky. See `rive/README.md` for its build commands, state contract, verification and integration limits. The static app icon is installed separately as described below.

## Installed app icon

`app-icon.svg` uses the selected v3 face on sage with a transparent platform margin. It is the source for the packaged app icons in `apps/native/src-tauri/icons`, configured in `tauri.conf.json`. Regenerate from the project root with:

```sh
pnpm --filter @freddai/native tauri icon ../../assets/brand/dormouse/app-icon.svg --ios-color '#969D76'
```

The macOS app was rebuilt using `pnpm native:install`, signed with the existing Developer ID, installed in `/Applications/Freddai.app`, and normally quit/relaunched. The installed `icon.icns` was verified byte-for-byte against the generated source; the new running process maps the installed executable and matches the rebuilt bundle. Workspace typechecks and native frontend/Rust build passed. The build reported an existing JavaScript chunk-size advisory. Generated Windows/mobile assets were not built or device-tested. Rive animation is now integrated in the header, with browser verification and native startup limitations recorded in `rive/README.md` and the product specification.

## Archived: v4, larger body

`dormouse-v4.svg` and `dormouse-icon-v4.svg` preserve the rejected larger-body option. Use `--version v4` only to regenerate that alternative.

## Previous exploration: v3, closer to the selected dormouse

`dormouse-v3.svg` and `dormouse-icon-v3.svg` retain v2's Tucky-based construction while softening the head into an oval, reducing the ears and nose, filling out the cream cheeks, shortening and widening the body, and replacing the exposed curled tail with a fluffy resting tail. A small single smile replaces the double muzzle curve. Eyes, paws, palette and sage icon background stay consistent.

Pass `--version v3` to reproduce this candidate. Both v3 files were XML-validated, checked for unique IDs, rendered at 900 px and visually inspected. Rive animation and app installation remain outside this artwork revision.

## Previous exploration: v2, adapted from Tucky

Denis rejected the first vector interpretation and requested adapting Tucky's design language. `dormouse-v2.svg` and `dormouse-icon-v2.svg` are the revised candidates; the first pass is preserved below for history.

The revision reuses Tucky's actual head outline, eye construction, body, brows and nose from `public/mascot/tucky-animated.svg` in the local Tucky project. It replaces the stripes, pointed ears, satchel and held props with round ears, dark dormouse eye patches, simple paws, warmer biscuit fur and a curled tail. Tucky source files were read only and were not modified.

`adapt-tucky.py --source /absolute/path/to/tucky/public/mascot/tucky-animated.svg` regenerates the versioned SVGs. The generated SVGs are standalone and do not need the source project to render. Separate named parts and supported SVG gradients are retained. No scripts, CSS animations, external resources or raster content are embedded. Eye clipping is included; eyelids, rigging and animation remain to be created in Rive.

Both v2 SVGs were XML-validated, checked for unique IDs, rendered at 900 px via macOS Quick Look and visually inspected. They have not been imported into Rive or installed in the app. Tucky's local Rive authoring source was found at `src/desktop-pet/rive/tucky-v2/`; no Rive build or integration was performed in this revision.

## First pass, superseded

First editable vector interpretation of the selected dormouse concept. The illustration intentionally simplifies the raster concept's fur and paper texture into solid shapes. Artwork is exploratory and has not replaced the installed app icon or been connected to the interface.

- `dormouse.svg`: transparent 512 × 512 full character, with separately named head, ears, eye patches, pupils, glints, nose, mouth, whiskers, body, belly, feet, paws and tail.
- `dormouse-icon.svg`: matching static face crop on a sage rounded square. This is an icon concept, not a packaged platform icon set. Platform-specific masks and safe areas still need preparation.

## Animation source and current verification

The selected SVG is unchanged; animation-specific layers are generated separately in `rive/scene.rml`. The Rive source, compiled local `.riv`, state review video, and runtime contract are described in [rive/README.md](rive/README.md).

Static SVG files were XML-validated and visually inspected. The Rive project passes local compile and resolved-tree inspection. Application integration and installed-app playback remain unverified.

Official SVG import reference: https://rive.app/docs/editor/assets/svg

The generated iOS Xcode asset catalog must use those same existing platform images. `scripts/sync-ios-icons.py`, invoked automatically by the iOS build hook, copies all manifest entries from `apps/native/src-tauri/icons/ios` into `gen/apple/Assets.xcassets/AppIcon.appiconset`. This prevents Xcode’s initial Tauri placeholder artwork from shipping after project initialization.
