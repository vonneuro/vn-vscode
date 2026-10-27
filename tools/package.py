"""Build vonneuro-<version>.vsix without Node: a .vsix is a zip with a manifest and the extension's files.

    python tools/package.py            # then: code --install-extension vonneuro-0.1.0.vsix

(`npx @vscode/vsce package` builds the same, for publishing to the Marketplace.)
"""
import json
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
FILES = ["package.json", "extension.js", "README.md", "CHANGELOG.md", "LICENSE", "src/*.js", "media/*", "examples/*.py"]

CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".md" ContentType="text/markdown"/><Default Extension=".svg" ContentType="image/svg+xml"/>
  <Default Extension=".png" ContentType="image/png"/><Default Extension=".py" ContentType="text/x-python"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/><Default Extension=".txt" ContentType="text/plain"/>
  <Override PartName="/extension/LICENSE" ContentType="text/plain"/>
</Types>"""


def manifest(pkg: dict) -> str:
    keywords = ",".join(pkg.get("keywords", []))
    return f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{pkg['name']}" Version="{pkg['version']}" Publisher="{pkg['publisher']}"/>
    <DisplayName>{escape(pkg['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(pkg['description'])}</Description>
    <Tags>{escape(keywords)}</Tags>
    <Categories>{escape(",".join(pkg.get("categories", [])))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{pkg['engines']['vscode']}"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="{pkg['repository']['url']}"/>
    </Properties>
    <License>extension/LICENSE</License>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
  </Assets>
</PackageManifest>"""


def main() -> Path:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    out = ROOT / f"{pkg['name']}-{pkg['version']}.vsix"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as vsix:
        vsix.writestr("[Content_Types].xml", CONTENT_TYPES)
        vsix.writestr("extension.vsixmanifest", manifest(pkg))
        for pattern in FILES:
            for path in sorted(ROOT.glob(pattern)):
                vsix.write(path, "extension/" + path.relative_to(ROOT).as_posix())
    print("built", out)
    return out


if __name__ == "__main__":
    main()
