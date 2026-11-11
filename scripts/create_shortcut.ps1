# Creates the "Folio PDF Editor" shortcut on the Desktop (and in the Start menu).
# Double-click it to boot the local server and open the editor window.
# You can also drop a PDF onto the shortcut to open it directly.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pythonw = Join-Path $root '.venv\Scripts\pythonw.exe'
if (-not (Test-Path $pythonw)) { throw "Python environment not found. Run Setup.bat first." }
$launcher = Join-Path $root 'launcher.pyw'
$icon = Join-Path $root 'assets\icon.ico'

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Folio PDF Editor.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio PDF Editor.lnk')
)
foreach ($path in $targets) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $pythonw
  $lnk.Arguments = "`"$launcher`""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'Folio PDF Editor - edit, sign and annotate PDFs locally'
  $lnk.Save()
  Write-Host "Created $path"
}
