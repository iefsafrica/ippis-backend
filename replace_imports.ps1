
$files = Get-ChildItem -Path "app" -Filter "*.ts*" -Recurse
foreach ($file in $files) {
    $fullName = $file.FullName
    try {
        $content = [System.IO.File]::ReadAllText($fullName)
        # Regex to match relative imports of lib/cors
        $pattern = 'import\s*\{\s*withCors\s*,\s*handleOptions\s*\}\s*from\s*["''](\.\.\/|\.\/|\.\.\/\.\.\.\/)+lib\/cors["''](;|)'
        
        if ($content -match $pattern) {
            $newContent = $content -replace 'import\s*\{\s*withCors\s*,\s*handleOptions\s*\}\s*from\s*["''](\.\.\/|\.\/|\.\.\/\.\.\.\/)+lib\/cors["''](;|)', 'import { withCors, handleOptions } from "@/lib/cors";'
            
            if ($content -ne $newContent) {
                [System.IO.File]::WriteAllText($fullName, $newContent)
                Write-Output "Updated: $fullName"
            }
        }
    } catch {
        Write-Output "Error processing $fullName : $_"
    }
}
