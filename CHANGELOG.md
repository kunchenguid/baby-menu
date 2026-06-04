# Changelog

## [0.1.15](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.14...baby-menu-v0.1.15) (2026-06-04)


### Bug Fixes

* **main:** compile layout CSS from symlinked workspaces ([#56](https://github.com/kunchenguid/baby-menu/issues/56)) ([ffa06e4](https://github.com/kunchenguid/baby-menu/commit/ffa06e4e55736e8ab530779ee4cc43730f21bd13))

## [0.1.14](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.13...baby-menu-v0.1.14) (2026-06-04)


### Bug Fixes

* **main:** harden extension workspace seeding on startup ([#54](https://github.com/kunchenguid/baby-menu/issues/54)) ([34fa98b](https://github.com/kunchenguid/baby-menu/commit/34fa98bbaf907d6b54ad5d08bd0b49f3cd8e36ad))

## [0.1.13](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.12...baby-menu-v0.1.13) (2026-06-03)


### Bug Fixes

* **main:** preserve dev workspace rollback state ([#51](https://github.com/kunchenguid/baby-menu/issues/51)) ([a39a4a7](https://github.com/kunchenguid/baby-menu/commit/a39a4a750de453e115c6e4cdf72efbddd1c97efa))

## [0.1.12](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.11...baby-menu-v0.1.12) (2026-06-03)


### Bug Fixes

* **adapters:** preserve configured Codex model ([#48](https://github.com/kunchenguid/baby-menu/issues/48)) ([bf798ce](https://github.com/kunchenguid/baby-menu/commit/bf798cedd68f3aae69dbf5b2b256c0ee8fe97572))
* label agent changes from workspace diffs ([#46](https://github.com/kunchenguid/baby-menu/issues/46)) ([7f0bc32](https://github.com/kunchenguid/baby-menu/commit/7f0bc32d45c6fdc7fad4fdcadfa86c0773bba773))

## [0.1.11](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.10...baby-menu-v0.1.11) (2026-06-03)


### Bug Fixes

* **renderer:** prevent custom popover layouts from clipping ([#44](https://github.com/kunchenguid/baby-menu/issues/44)) ([04a0fa6](https://github.com/kunchenguid/baby-menu/commit/04a0fa62b1f9214193a91e7687fac8f4552d75f0))

## [0.1.10](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.9...baby-menu-v0.1.10) (2026-05-29)


### Features

* support custom popover layouts ([#40](https://github.com/kunchenguid/baby-menu/issues/40)) ([b9296f6](https://github.com/kunchenguid/baby-menu/commit/b9296f6103b471efdbb638e52b82c2e20f4c8ac6))


### Bug Fixes

* **main:** record popover opens as pageviews ([#41](https://github.com/kunchenguid/baby-menu/issues/41)) ([5d4e8f5](https://github.com/kunchenguid/baby-menu/commit/5d4e8f580e3ce3b87443c629ceced7d8cf0b8517))

## [0.1.9](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.8...baby-menu-v0.1.9) (2026-05-29)


### Bug Fixes

* **main:** recover stale agent sessions ([#38](https://github.com/kunchenguid/baby-menu/issues/38)) ([95e5256](https://github.com/kunchenguid/baby-menu/commit/95e52560246b446f9cc71079421a6991175111eb))

## [0.1.8](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.7...baby-menu-v0.1.8) (2026-05-29)


### Features

* add update available indicator ([#36](https://github.com/kunchenguid/baby-menu/issues/36)) ([4c4a118](https://github.com/kunchenguid/baby-menu/commit/4c4a1180a643e378250ac1299a14ccedb0a38041))
* **main:** add anonymous Umami telemetry ([#35](https://github.com/kunchenguid/baby-menu/issues/35)) ([3070174](https://github.com/kunchenguid/baby-menu/commit/3070174ab3ce5d700607944cc3d48ecd9cb7c95f))


### Bug Fixes

* **adapters:** omit Codex color flag on resume ([#32](https://github.com/kunchenguid/baby-menu/issues/32)) ([4ebe593](https://github.com/kunchenguid/baby-menu/commit/4ebe5931039f470a7c655039feef542923f46b09))
* relaunch Baby Menu after Homebrew upgrades ([#37](https://github.com/kunchenguid/baby-menu/issues/37)) ([5c370ab](https://github.com/kunchenguid/baby-menu/commit/5c370abc9069df4c77eb7ec4553664655f6f13d0))

## [0.1.7](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.6...baby-menu-v0.1.7) (2026-05-29)


### Bug Fixes

* **extensions:** ship stable extension contract types ([#29](https://github.com/kunchenguid/baby-menu/issues/29)) ([53ab316](https://github.com/kunchenguid/baby-menu/commit/53ab316b6f330c6b56bd0938eddaf9ccf2d7a7cb))

## [0.1.6](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.5...baby-menu-v0.1.6) (2026-05-29)


### Features

* **adapters:** bundle Claude and Codex ACP adapters ([#26](https://github.com/kunchenguid/baby-menu/issues/26)) ([b2189f7](https://github.com/kunchenguid/baby-menu/commit/b2189f7a5e4f0761d4b7d6992b86d3ea7a262123))
* add custom ACP agent settings ([#28](https://github.com/kunchenguid/baby-menu/issues/28)) ([d9742f2](https://github.com/kunchenguid/baby-menu/commit/d9742f2bfdb45f38ded311b55be1fdd0b68befcf))

## [0.1.5](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.4...baby-menu-v0.1.5) (2026-05-29)


### Bug Fixes

* separate local mac app bundle identity ([#23](https://github.com/kunchenguid/baby-menu/issues/23)) ([98d7da0](https://github.com/kunchenguid/baby-menu/commit/98d7da0fe3bb36c9d1cac2a7589b98da7cce6730))

## [0.1.4](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.3...baby-menu-v0.1.4) (2026-05-28)


### Bug Fixes

* preserve native binaries in universal macOS package ([#21](https://github.com/kunchenguid/baby-menu/issues/21)) ([73bacd0](https://github.com/kunchenguid/baby-menu/commit/73bacd066b7aed1ad9f265f5d00b65c998010bb4))

## [0.1.3](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.2...baby-menu-v0.1.3) (2026-05-28)


### Features

* add selectable embedded agents ([#16](https://github.com/kunchenguid/baby-menu/issues/16)) ([45fc4e7](https://github.com/kunchenguid/baby-menu/commit/45fc4e79f6d583d572699c80003017c74c0a5d62))
* **main:** add extension storage and background tasks ([#17](https://github.com/kunchenguid/baby-menu/issues/17)) ([e1c615d](https://github.com/kunchenguid/baby-menu/commit/e1c615dded31f605c6ff538f6844dc218310d8e7))
* **renderer:** add extension settings sections ([#18](https://github.com/kunchenguid/baby-menu/issues/18)) ([bb48654](https://github.com/kunchenguid/baby-menu/commit/bb48654aa14b8e731c4a74bf53cf0dfe9014e7d6))
* **renderer:** add quit control to menu ([#14](https://github.com/kunchenguid/baby-menu/issues/14)) ([5a364d3](https://github.com/kunchenguid/baby-menu/commit/5a364d35f8a123ab81b1e11a4e7977bd119f3a73))
* **ui:** add shared design system for widgets ([#13](https://github.com/kunchenguid/baby-menu/issues/13)) ([bd63602](https://github.com/kunchenguid/baby-menu/commit/bd6360255e4e4d252945f77a1e10b963324035d7))


### Bug Fixes

* **main:** preserve server action module state ([#19](https://github.com/kunchenguid/baby-menu/issues/19)) ([4711719](https://github.com/kunchenguid/baby-menu/commit/47117193ab581857cf129ecb35d7f9686feb0f9d))
* **main:** restore tray popover cursor tracking ([#10](https://github.com/kunchenguid/baby-menu/issues/10)) ([00ac580](https://github.com/kunchenguid/baby-menu/commit/00ac580fb85bfa5fec988455854c3811fef5146a))
* **main:** skip login item updates in source dev mode ([#9](https://github.com/kunchenguid/baby-menu/issues/9)) ([6a476c3](https://github.com/kunchenguid/baby-menu/commit/6a476c302b45100ab6715d59d1f2ad858f03784f))
* **renderer:** clarify system start setting label ([#15](https://github.com/kunchenguid/baby-menu/issues/15)) ([434411e](https://github.com/kunchenguid/baby-menu/commit/434411ec1d6c86b3358e0e06a9ab0af983efa5d8))
* **renderer:** restore agent turn state across remounts ([#20](https://github.com/kunchenguid/baby-menu/issues/20)) ([f610b00](https://github.com/kunchenguid/baby-menu/commit/f610b000f65131e9db2927933a5a32effb228b71))
* **renderer:** use native cursors and enforce refreshable intervals ([#12](https://github.com/kunchenguid/baby-menu/issues/12)) ([911679f](https://github.com/kunchenguid/baby-menu/commit/911679f8515ab4e22e88058ba185f28631c44e6b))

## [0.1.2](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.1...baby-menu-v0.1.2) (2026-05-21)


### Bug Fixes

* **main:** suppress macOS keychain prompts ([#7](https://github.com/kunchenguid/baby-menu/issues/7)) ([368d0ee](https://github.com/kunchenguid/baby-menu/commit/368d0eefa73dbfb4446ed849d1ddddf0dac68d73))

## [0.1.1](https://github.com/kunchenguid/baby-menu/compare/baby-menu-v0.1.0...baby-menu-v0.1.1) (2026-05-21)


### Features

* add packaged app runtime support ([#2](https://github.com/kunchenguid/baby-menu/issues/2)) ([5b608cd](https://github.com/kunchenguid/baby-menu/commit/5b608cdc4a68dc803cd968d0136efb027846da8b))
* initial commit ([cd62540](https://github.com/kunchenguid/baby-menu/commit/cd62540a97e5541b03c65896edec1d71d63d5b32))
* **main:** enable packaged app login launch by default ([#3](https://github.com/kunchenguid/baby-menu/issues/3)) ([c6e6925](https://github.com/kunchenguid/baby-menu/commit/c6e692586d51443fa373e0dd4d6d26d432f63cde))


### Bug Fixes

* **extensions:** load recipes from extension workspace ([5b27cb3](https://github.com/kunchenguid/baby-menu/commit/5b27cb31575d9e86724c3b5806c4e8faa5f05fb2))
* **extensions:** load recipes from extension workspace ([5b27cb3](https://github.com/kunchenguid/baby-menu/commit/5b27cb31575d9e86724c3b5806c4e8faa5f05fb2))
* **extensions:** load recipes from extension workspace ([e81a82c](https://github.com/kunchenguid/baby-menu/commit/e81a82c20733162172f86cf751878feb7a49e733))
* **main:** add packaged icons and reject overlapping agent turns ([#4](https://github.com/kunchenguid/baby-menu/issues/4)) ([d68558a](https://github.com/kunchenguid/baby-menu/commit/d68558aa3c7fbf2d298103a3e9dd15ce9a79b8fc))


### Miscellaneous Chores

* release 0.1.1 ([25450cf](https://github.com/kunchenguid/baby-menu/commit/25450cf5c712ca363649a9bc7f7e7c978033da94))
