Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = appDir & "\node\node.exe"
serverJs = appDir & "\backend\dist\server.js"
lockFile = appDir & "\server.lock"
port = "3001"

If Not fso.FileExists(nodeExe) Then
    MsgBox "Nie znaleziono node\node.exe" & vbCrLf & vbCrLf & "Pobierz Node.js portable z nodejs.org i wrzuc do folderu node\", vbCritical, "Kappa Plannung"
    WScript.Quit 1
End If

If Not fso.FileExists(serverJs) Then
    MsgBox "Nie znaleziono backend\dist\server.js" & vbCrLf & "Sprawdz czy aplikacja jest kompletna.", vbCritical, "Kappa Plannung"
    WScript.Quit 1
End If

If fso.FileExists(lockFile) Then
    Set f = fso.OpenTextFile(lockFile, 1)
    serverIP = Trim(f.ReadLine)
    f.Close
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP.6.0")
    http.Open "GET", "http://" & serverIP & ":" & port & "/api/health", False
    http.setRequestHeader "Connection", "close"
    http.Send
    statusCode = http.Status
    On Error GoTo 0
    If statusCode = 200 Then
        shell.Run "http://" & serverIP & ":" & port, 1, False
        WScript.Quit 0
    Else
        fso.DeleteFile lockFile, True
    End If
End If

localIP = "localhost"
Set exec = shell.Exec("cmd /c ipconfig | findstr /C:""IPv4""")
output = exec.StdOut.ReadAll
lines = Split(output, vbCrLf)
For Each line In lines
    pos = InStr(line, ":")
    If pos > 0 Then
        ip = Trim(Mid(line, pos + 1))
        If ip <> "" And ip <> "127.0.0.1" Then localIP = ip
    End If
Next

Set f = fso.CreateTextFile(lockFile, True)
f.WriteLine localIP
f.Close

shell.CurrentDirectory = appDir
Set env = shell.Environment("Process")
env("NODE_ENV") = "production"
shell.Run """" & nodeExe & """ """ & serverJs & """", 0, False

serverReady = False
For i = 1 To 20
    WScript.Sleep 1000
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP.6.0")
    http.Open "GET", "http://localhost:" & port & "/api/health", False
    http.setRequestHeader "Connection", "close"
    http.Send
    If http.Status = 200 Then
        serverReady = True
        On Error GoTo 0
        Exit For
    End If
    On Error GoTo 0
Next

If Not serverReady Then
    If fso.FileExists(lockFile) Then fso.DeleteFile lockFile, True
    MsgBox "Serwer nie uruchomil sie w ciagu 20 sekund." & vbCrLf & "Sprawdz czy port 3001 nie jest zajety.", vbExclamation, "Kappa Plannung"
    WScript.Quit 1
End If

shell.Run "http://" & localIP & ":" & port, 1, False

MsgBox "Kappa Plannung dziala!" & vbCrLf & vbCrLf & "Adres: http://" & localIP & ":" & port & vbCrLf & vbCrLf & "Inni uzytkownicy moga sie polaczyc klikajac swoja ikone." & vbCrLf & vbCrLf & "Kliknij OK aby ZATRZYMAC serwer.", vbInformation, "Kappa Plannung"

On Error Resume Next
shell.Run "taskkill /f /im node.exe", 0, True
If fso.FileExists(lockFile) Then fso.DeleteFile lockFile, True
On Error GoTo 0
