# Demo signing key

`teeco-demo.keystore` signs the sideloaded demo APK (alias `androiddebugkey`, password `android`, the standard
Android debug-key settings). Keeping it fixed means each new APK installs over the previous one.

It is committed on purpose and is **not secret**. Before publishing on Google Play, create a private release key,
store it as a GitHub Actions secret, and build a signed release instead of this debug build.
