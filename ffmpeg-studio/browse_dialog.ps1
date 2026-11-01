param(
    [string]$Mode = "open",
    [string]$Filter = "All Files (*.*)|*.*",
    [switch]$Multi
)
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null

# Transparent topmost owner form: forces the dialog to appear in front
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(0, 0)
$owner.Show()

if ($Mode -eq "save") {
    $d = New-Object System.Windows.Forms.SaveFileDialog
    $d.Filter = $Filter
    $d.Title = "Select save location"
    $result = $d.ShowDialog($owner)
    $owner.Close()
    if ($result -eq 'OK') { [Console]::Out.Write($d.FileName) }
} else {
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.Filter = $Filter
    $d.Multiselect = [bool]$Multi
    $d.Title = "Select file"
    $result = $d.ShowDialog($owner)
    $owner.Close()
    if ($result -eq 'OK') {
        if ($d.Multiselect) { [Console]::Out.Write(($d.FileNames -join [char]10)) }
        else { [Console]::Out.Write($d.FileName) }
    }
}
