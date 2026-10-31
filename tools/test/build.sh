#!/usr/bin/env bash
# Build TestHelper.dll (tools/test/TestHelper.cs) with the .NET SDK's C# compiler against the game's own assemblies.
# Usage: tools/test/build.sh "<game>/Cult Of The Lamb_Data/Managed" "<game>/BepInEx/core"
set -euo pipefail
MANAGED=$1 BEPINEX=$2
HERE=$(cd "$(dirname "$0")" && pwd)
DOTNET=${DOTNET:-dotnet}
SDK=$("$DOTNET" --list-sdks | tail -1 | sed -E 's/^([^ ]+) \[(.*)\]$/\2\/\1/')
refs=()
for f in "$MANAGED"/*.dll; do refs+=("-r:$f"); done
"$DOTNET" "$SDK/Roslyn/bincore/csc.dll" -nologo -target:library -nostdlib -langversion:latest -optimize -nowarn:CS1701,CS1702 \
  "${refs[@]}" -r:"$BEPINEX/BepInEx.dll" -r:"$BEPINEX/0Harmony.dll" \
  -out:"$HERE/TestHelper.dll" "$HERE/TestHelper.cs"
echo "built $HERE/TestHelper.dll"
