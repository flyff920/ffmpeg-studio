param(
    [string]$Mode = "open",
    [string]$Filter = "All Files (*.*)|*.*",
    [string]$OutFile = "",
    [switch]$Multi
)

# NOTE: keep this file ASCII-only.
# Windows PowerShell 5.1 decodes .ps1 without a BOM as ANSI, so non-ASCII
# characters here would be mis-read (mojibake / broken parsing).
# The picked path(s) are written to $OutFile as UTF-8, so Chinese paths are safe.

$ErrorActionPreference = "Stop"
$owner = $null
$picked = @()

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    # Invisible topmost owner form: forces the dialog to appear in front
    # instead of hiding behind the browser window.
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.FormBorderStyle = 'None'
    $owner.Opacity = 0
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = New-Object System.Drawing.Size(0, 0)
    $owner.Show()

    if ($Mode -eq "folder") {
        $d = New-Object System.Windows.Forms.FolderBrowserDialog
        $d.Description = "Select folder"
        $d.ShowNewFolderButton = $false
        $result = $d.ShowDialog($owner)
        if ($result -eq 'OK' -and $d.SelectedPath) { $picked = @($d.SelectedPath) }
    } elseif ($Mode -eq "save") {
        $d = New-Object System.Windows.Forms.SaveFileDialog
        $d.Filter = $Filter
        $d.Title = "Select save location"
        $result = $d.ShowDialog($owner)
        if ($result -eq 'OK' -and $d.FileName) { $picked = @($d.FileName) }
    } else {
        $d = New-Object System.Windows.Forms.OpenFileDialog
        $d.Filter = $Filter
        $d.Multiselect = [bool]$Multi
        $d.Title = "Select file"
        $result = $d.ShowDialog($owner)
        if ($result -eq 'OK') {
            if ($d.Multiselect) {
                foreach ($f in $d.FileNames) { if ($f) { $picked += $f } }
            } elseif ($d.FileName) {
                $picked = @($d.FileName)
            }
        }
    }
} catch {
    # Report to stderr; the backend shows this text to the user.
    [Console]::Error.Write($_.Exception.Message)
    if ($owner) { try { $owner.Dispose() } catch { } }
    exit 1
}

if ($owner) { try { $owner.Close(); $owner.Dispose() } catch { } }

$text = ($picked -join "`n")
if ($OutFile -ne "") {
    # UTF-8 without BOM: Chinese paths bypass the console code page entirely.
    [System.IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($false)))
} else {
    [Console]::Out.Write($text)
}
