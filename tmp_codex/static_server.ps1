param(
    [string]$Root = (Get-Location).Path,
    [int]$Port = 8010
)

$ErrorActionPreference = "Stop"

function Get-ContentType {
    param([string]$Path)

    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".js" { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".webmanifest" { "application/manifest+json; charset=utf-8" }
        ".png" { "image/png" }
        ".jpg" { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".webp" { "image/webp" }
        ".gif" { "image/gif" }
        ".svg" { "image/svg+xml" }
        ".ico" { "image/x-icon" }
        ".pdf" { "application/pdf" }
        ".mp4" { "video/mp4" }
        ".ttf" { "font/ttf" }
        ".otf" { "font/otf" }
        ".woff" { "font/woff" }
        ".woff2" { "font/woff2" }
        default { "application/octet-stream" }
    }
}

$rootPath = [IO.Path]::GetFullPath($Root)
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $relativePath = [Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($relativePath)) {
                $relativePath = "index.html"
            }

            $targetPath = [IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))

            if (-not $targetPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $bytes = [Text.Encoding]::UTF8.GetBytes("Forbidden")
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                continue
            }

            if ((Test-Path $targetPath) -and (Get-Item $targetPath).PSIsContainer) {
                $targetPath = Join-Path $targetPath "index.html"
            }

            if (-not (Test-Path $targetPath -PathType Leaf)) {
                $response.StatusCode = 404
                $bytes = [Text.Encoding]::UTF8.GetBytes("Not Found")
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                continue
            }

            $payload = [IO.File]::ReadAllBytes($targetPath)
            $response.StatusCode = 200
            $response.ContentType = Get-ContentType -Path $targetPath
            $response.ContentLength64 = $payload.LongLength

            if ($request.HttpMethod -ne "HEAD") {
                $response.OutputStream.Write($payload, 0, $payload.Length)
            }
        }
        catch {
            $response.StatusCode = 500
            $bytes = [Text.Encoding]::UTF8.GetBytes("Internal Server Error")
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        finally {
            $response.OutputStream.Close()
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
