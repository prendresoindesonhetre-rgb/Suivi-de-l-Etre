$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8934/")
$listener.Start()
Write-Host "Serving $root on http://localhost:8934/"
while ($listener.IsListening) {
  $context = $listener.GetContext()
  $path = $context.Request.Url.LocalPath
  if ($path -eq "/") { $path = "/index.html" }
  $filePath = Join-Path $root ($path.TrimStart('/'))
  try {
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $ext = [System.IO.Path]::GetExtension($filePath)
    $ct = switch ($ext) { ".html" {"text/html"} ".js" {"application/javascript"} ".json" {"application/json"} ".png" {"image/png"} default {"application/octet-stream"} }
    $context.Response.ContentType = $ct
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    $context.Response.StatusCode = 404
  }
  $context.Response.OutputStream.Close()
}
