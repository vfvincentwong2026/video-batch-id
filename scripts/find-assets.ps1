Get-ChildItem -Path 'D:\','C:\Users' -Recurse -Filter 'Konten*' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  ForEach-Object { "{0}`t{1:N0} bytes" -f $_.FullName, $_.Length }
"--- mp4 on D:\ (top 30) ---"
Get-ChildItem -Path 'D:\' -Recurse -Include '*.mp4' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|anaconda|Program Files' } |
  Select-Object -First 30 |
  ForEach-Object { $_.FullName }
