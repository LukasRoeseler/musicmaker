$port = 8123
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving on http://localhost:$port/"
$root = Split-Path $MyInvocation.MyCommand.Path
while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.LocalPath
    if ($path -eq "/") { $path = "/index.html" }
    $file = Join-Path $root $path.TrimStart('/')
    if (Test-Path $file -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext = [System.IO.Path]::GetExtension($file).ToLower()
        switch ($ext) {
            ".svg"  { $ctx.Response.ContentType = "image/svg+xml" }
            ".json" { $ctx.Response.ContentType = "application/json; charset=utf-8" }
            ".js"   { $ctx.Response.ContentType = "text/javascript; charset=utf-8" }
            ".css"  { $ctx.Response.ContentType = "text/css; charset=utf-8" }
            ".mid"  { $ctx.Response.ContentType = "audio/midi" }
            default { $ctx.Response.ContentType = "text/html; charset=utf-8" }
        }
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
}
