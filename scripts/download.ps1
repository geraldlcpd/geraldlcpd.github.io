$dir = $PSScriptRoot
$h = [ordered]@{
    'lucide.min.js' = 'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js'
    'marked.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js'
    'highlight.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
    'tokyo-night-dark.min.css' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css'
    'mqtt.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/mqtt/4.3.7/mqtt.min.js'
    'mermaid.min.js' = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'
    'json.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js'
    'python.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js'
    'javascript.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/javascript.min.js'
    'typescript.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js'
    'css.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/css.min.js'
    'xml.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/xml.min.js'
    'cpp.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/cpp.min.js'
    'java.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/java.min.js'
    'sql.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/sql.min.js'
    'rust.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/rust.min.js'
    'go.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/go.min.js'
    'bash.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js'
    'yaml.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/yaml.min.js'
    'markdown.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/markdown.min.js'
    'diff.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/diff.min.js'
}

foreach ($key in $h.Keys) {
    $url = $h[$key]
    if ($key -like '*.css') {
        $outFile = Join-Path $dir "ocputils\styles\$key"
    } else {
        $outFile = Join-Path $dir "ocputils\syntax\$key"
    }
    Write-Host "Downloading $key..."
    Invoke-WebRequest -Uri $url -OutFile $outFile
}
Write-Host "All assets downloaded successfully!"
