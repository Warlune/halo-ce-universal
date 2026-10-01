# Windows native build prerequisites

This is a dependency request and build plan, not an installer. This document
does not authorize installation or execution of downloaded dependencies.

The checkout requires clang/lld targeting `i686-pc-windows-msvc`, Microsoft x86
C/C++ runtime libraries and Windows SDK headers/libraries, Python, Ninja and SDL3
development files. No Xbox SDK is required. A Visual C++ Redistributable alone
does not provide the development libraries.

## Proposed official dependencies

| Component | Exact proposal | Official source |
| --- | --- | --- |
| Microsoft Build Tools | VS Build Tools 2022 servicing channel; C++ workload `Microsoft.VisualStudio.Workload.VCTools`, x86/x64 tools `Microsoft.VisualStudio.Component.VC.Tools.x86.x64`, SDK `Microsoft.VisualStudio.Component.Windows11SDK.26100`, and required dependencies | [Microsoft bootstrapper](https://aka.ms/vs/17/release/vs_buildtools.exe), [component catalog](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022) |
| LLVM | 23.1.2 official x86_64 Windows MSVC archive with clang/lld | [LLVM release](https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.2) |
| Ninja | 1.13.2 `ninja-win.zip` | [Ninja release](https://github.com/ninja-build/ninja/releases/tag/v1.13.2) |
| SDL3 | 3.4.16 `SDL3-devel-3.4.16-VC.zip`, pinned by this checkout | [SDL release](https://github.com/libsdl-org/SDL/releases/tag/release-3.4.16) |
| Python | Reuse existing Python 3.12.14; no installation needed | Existing development runtime |

The Microsoft servicing channel is not immutable. Record the resolved version,
Microsoft signature, selected components and disk estimate before approving its
installation transaction. The inspected catalog lists MSVC v143 and Windows SDK
10.0.26100.3916. Avoid optional IDE, ATL/MFC, ARM, web or other workloads unless
a build failure establishes a need and that expansion is approved.

Official GitHub release metadata inspected on 2026-10-01 reports:

| File | Download bytes | SHA-256 |
| --- | ---: | --- |
| `clang+llvm-23.1.2-x86_64-pc-windows-msvc.tar.xz` | 901325176 | `8fb91cdc44fcbbdcf6b3ffd0a1f9859abd14a3c3aae4423c2b6d4a4f90bf0095` |
| `ninja-win.zip` | 291570 | `07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65` |
| `SDL3-devel-3.4.16-VC.zip` | 16864776 | `1a784cb2a5c64d56fe7a62090fe9d242d9865f235e4ea9678f1a6ba4e693e7de` |

Reverify artifacts at download time. Sizes are compressed downloads, not expanded
requirements. Microsoft documents a broad **2.3–60 GB** Build Tools range depending
on features, not an estimate for this specific selection.
([Microsoft requirements](https://learn.microsoft.com/en-us/visualstudio/releases/2022/system-requirements))
Expanded tools, installer cache, build intermediates, symbols and copied game
assets add to this. Total space remains unknown until component selection and
archive inspection.

## Install/build boundary

Prefer portable LLVM/Ninja and build outputs on the development drive. Microsoft
Build Tools/SDK are system installations and may write shared components/cache
to the system drive even with a custom target. Approval must cover these writes;
do not promise a completely portable or D:-only install. Use process-local PATH
for portable tools, with no credentials or firewall/router changes.

After explicit approval and verification, audit configure/build generators before
running them. `generate_windows_build` calls `fetch_sdl` before checking other
prerequisites. Prestage the verified SDL package in `build/windows/third_party`
to avoid its automatic download. Initially configure with the existing Python
and `--portable --pgo=off --lto=off`, and build with a conservative job limit.
This avoids profile training and its extra compiler-rt download, and makes the
first build easier to diagnose. Do not execute Halo as part of compilation.
Use isolated runtime configuration only after successful compile/link and record
actual versions and results.
