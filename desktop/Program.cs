using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Stringcraft.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        string identity = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        string name = @"Local\Stringcraft.Desktop." + identity;
        using var activate = new EventWaitHandle(false, EventResetMode.AutoReset, name + ".Activate");
        using var instance = new Mutex(true, name, out bool created);
        if (!created)
        {
            activate.Set();
            return;
        }

        var workspace = ManagedWorkspace.Find();
        string data = Environment.GetEnvironmentVariable("STRINGCRAFT_DATA")
            ?? (workspace is null ? null : Path.Combine(workspace.Root, "data"))
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Stringcraft", "Desktop");
        try
        {
            if (workspace is not null && !workspace.Contains(data))
                throw new InvalidOperationException("数据目录必须位于弦作统一工作区内。");
            Directory.CreateDirectory(data);
            using var window = new WorkbenchWindow(data, activate);
            Application.Run(window);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "弦作启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

internal sealed class WorkbenchWindow : Form
{
    private const string Address = "http://127.0.0.1:18770/";
    private readonly ManagedWorkspace? workspace = ManagedWorkspace.Find();
    private readonly string data;
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };
    private readonly NotifyIcon tray;
    private readonly RegisteredWaitHandle activation;
    private readonly string desktopKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private Process? service;
    private ProcessTree? tree;
    private bool exiting;
    private bool exitPending;
    private bool workbenchReady;
    private bool importingRuntime;
    private TaskCompletionSource<bool>? saved;

    public WorkbenchWindow(string data, EventWaitHandle activate)
    {
        this.data = data;
        Text = "弦作 Stringcraft";
        MinimumSize = new Size(800, 540);
        Size = new Size(1390, 900);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? SystemIcons.Application;
        Controls.Add(view);
        var menu = new ContextMenuStrip();
        menu.Items.Add("显示工作台", null, (_, _) => RestoreWorkbench());
        menu.Items.Add("全局设置", null, (_, _) => { RestoreWorkbench(); Send("open-settings"); });
        menu.Items.Add("打开数据目录", null, (_, _) => OpenPath(data));
        menu.Items.Add("退出弦作", null, async (_, _) => await ExitAsync());
        tray = new NotifyIcon { Icon = Icon, Text = "弦作 Stringcraft", Visible = true, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => RestoreWorkbench();
        _ = Handle;
        activation = ThreadPool.RegisterWaitForSingleObject(activate, (_, _) =>
        {
            if (!IsDisposed && IsHandleCreated) BeginInvoke(RestoreWorkbench);
        }, null, Timeout.Infinite, false);
        Shown += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            if (string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString()))
                throw new InvalidOperationException("缺少 Microsoft Edge WebView2 Runtime。请按随包说明安装 Windows x64 离线运行时后重试。");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(data, "webview"));
            await view.EnsureCoreWebView2Async(environment);
            var core = view.CoreWebView2;
            if (workspace is not null)
            {
                Directory.CreateDirectory(workspace.Exports);
                core.Profile.DefaultDownloadFolderPath = workspace.Exports;
                core.DownloadStarting += (_, e) =>
                {
                    e.ResultFilePath = workspace.ExportPath(e.ResultFilePath);
                    e.Handled = true;
                };
            }
            ConfigureView(core);
            core.WebMessageReceived += ReceiveMessage;
            core.AddWebResourceRequestedFilter(Address + "*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += (_, e) =>
            {
                if (IsLocal(e.Request.Uri)) e.Request.Headers.SetHeader("X-Stringcraft-Desktop", desktopKey);
            };
            await StartServiceAsync();
            core.Navigate(Address);
        }
        catch (Exception error)
        {
            await StopServiceAsync();
            MessageBox.Show(this, error.Message, "弦作启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            await ExitAsync();
        }
    }

    private async Task StartServiceAsync()
    {
        string executable = Path.Combine(AppContext.BaseDirectory, "_internal", "service", "StringcraftService.exe");
        if (!File.Exists(executable))
            executable = Path.Combine(AppContext.BaseDirectory, "service", "StringcraftService.exe");
        var info = new ProcessStartInfo(executable, "--desktop --port 18770 --no-open")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardInput = true,
            WorkingDirectory = AppContext.BaseDirectory,
        };
        info.Environment["STRINGCRAFT_DATA"] = data;
        info.Environment["STRINGCRAFT_DESKTOP_KEY"] = desktopKey;
        info.Environment["STRINGCRAFT_PLUGIN_DIR"] = ModelDirectory();
        tree = new ProcessTree();
        service = Process.Start(info) ?? throw new InvalidOperationException("无法启动本地计算服务。");
        try { tree.Add(service); }
        catch { service.Kill(entireProcessTree: true); throw; }

        using var client = new HttpClient(new HttpClientHandler { UseProxy = false })
        { Timeout = TimeSpan.FromMilliseconds(700) };
        client.DefaultRequestHeaders.Add("X-Stringcraft-Desktop", desktopKey);
        for (int attempt = 0; attempt < 40; attempt++)
        {
            if (service.HasExited) break;
            try
            {
                using var response = await client.GetAsync(Address + "api/v1/capabilities");
                var proof = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(desktopKey)));
                if (response.StatusCode == HttpStatusCode.OK &&
                    response.Headers.TryGetValues("X-Stringcraft-Desktop-Ready", out var values) &&
                    values.Any(value => string.Equals(value, proof, StringComparison.OrdinalIgnoreCase))) return;
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            await Task.Delay(125);
        }
        throw new InvalidOperationException("无法连接本地服务。检查便携包是否完整解压，或 18770 端口是否已被其他程序占用。");
    }

    private static bool IsLocal(string value) => Uri.TryCreate(value, UriKind.Absolute, out Uri? uri)
        && uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 18770;

    private void ConfigureView(CoreWebView2 core)
    {
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.NavigationStarting += (_, e) => { if (!IsLocal(e.Uri) && e.Uri != "about:blank") e.Cancel = true; };
        core.NewWindowRequested += (_, e) =>
        {
            if (e.IsUserInitiated && Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri? uri)
                && uri.Scheme == "https" && !IsLocal(e.Uri))
            {
                e.Handled = true;
                OpenPath(uri.AbsoluteUri);
                return;
            }
            if (IsLocal(e.Uri) || e.Uri is "" or "about:blank")
                _ = OpenChildAsync(e);
            else e.Handled = true;
        };
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
    }

    private async Task OpenChildAsync(CoreWebView2NewWindowRequestedEventArgs e)
    {
        using var deferral = e.GetDeferral();
        var popup = new Form { Text = "弦作 · 文档与打印", Size = new Size(1000, 780), StartPosition = FormStartPosition.CenterParent };
        var child = new WebView2 { Dock = DockStyle.Fill };
        popup.Controls.Add(child);
        try
        {
            await child.EnsureCoreWebView2Async(view.CoreWebView2.Environment);
            ConfigureView(child.CoreWebView2);
            child.CoreWebView2.Settings.IsWebMessageEnabled = false;
            e.NewWindow = child.CoreWebView2;
            child.CoreWebView2.AddWebResourceRequestedFilter(Address + "*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            child.CoreWebView2.WebResourceRequested += (_, args) =>
            {
                if (IsLocal(args.Request.Uri)) args.Request.Headers.SetHeader("X-Stringcraft-Desktop", desktopKey);
            };
            child.CoreWebView2.WindowCloseRequested += (_, _) => popup.Close();
            popup.Show(this);
        }
        catch { popup.Dispose(); e.Handled = true; }
    }

    private void ReceiveMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsLocal(e.Source)) return;
        string command;
        try { command = e.TryGetWebMessageAsString(); }
        catch (ArgumentException) { return; }
        switch (command)
        {
            case "ready": workbenchReady = true; break;
            case "choose-models": ChooseModelDirectory(this); break;
            case "open-plugins": OpenPluginFolder(); break;
            case "import-cuda": _ = ImportCudaAsync(); break;
            case "open-data": OpenPath(data); break;
            case "quit": _ = ExitAsync(); break;
            case "print-tab": _ = SaveTabPdfAsync(); break;
            case "saved": saved?.TrySetResult(true); break;
            case "save-failed": saved?.TrySetResult(false); break;
        }
    }

    private void Send(string command) => view.CoreWebView2?.PostWebMessageAsString(command);

    private void OpenPluginFolder()
    {
        var inbox = Path.Combine(data, "plugins", "inbox");
        Directory.CreateDirectory(inbox);
        OpenPath(inbox);
    }

    private async Task ImportCudaAsync()
    {
        if (workspace is not null)
        {
            Send("runtime:统一工作区使用 runtime 中的共享环境。更新时请先关闭弦作，使用工作区的环境更新命令。");
            return;
        }
        if (importingRuntime) return;
        using var picker = new OpenFileDialog { Filter = "CUDA 离线扩展 (*.zip)|*.zip", CheckFileExists = true };
        if (picker.ShowDialog(this) != DialogResult.OK) return;
        importingRuntime = true;
        Send("runtime:正在校验和解压 CUDA 包…");
        try
        {
            string runtimes = Path.Combine(data, "plugins", "runtimes");
            string digest = await Task.Run(() => RuntimeArchive.Install(picker.FileName, runtimes));
            using var client = new HttpClient(new HttpClientHandler { UseProxy = false })
                { Timeout = TimeSpan.FromSeconds(140) };
            client.DefaultRequestHeaders.Add("X-Stringcraft-Desktop", desktopKey);
            client.DefaultRequestHeaders.Add("X-Stringcraft-Activation", desktopKey);
            using var session = JsonDocument.Parse(await client.GetStringAsync(Address + "api/v1/session"));
            client.DefaultRequestHeaders.Authorization = new("Bearer", session.RootElement.GetProperty("token").GetString());
            while (!exiting)
            {
                using var response = await client.PostAsync(Address + "api/v1/plugin-runtime/" + digest, null);
                if (response.StatusCode == HttpStatusCode.Conflict)
                {
                    Send("runtime:包已校验，等待当前作业结束…");
                    await Task.Delay(2000);
                    continue;
                }
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("CUDA 自检未通过，继续使用原环境。");
                File.WriteAllText(SettingsPath + ".tmp", JsonSerializer.Serialize(Path.Combine(runtimes, digest)));
                File.Move(SettingsPath + ".tmp", SettingsPath, true);
                Send("runtime:CUDA 环境已就绪。");
                Send("runtime-changed");
                break;
            }
        }
        catch (Exception error) { Send("runtime:" + error.Message); }
        finally { importingRuntime = false; }
    }

    private async Task SaveTabPdfAsync()
    {
        using var picker = new SaveFileDialog {
            Filter = "PDF|*.pdf", AddExtension = true, FileName = "Stringcraft.pdf",
            InitialDirectory = workspace?.Exports ?? "",
        };
        if (picker.ShowDialog(this) != DialogResult.OK) return;
        if (workspace is not null && !workspace.Contains(picker.FileName))
        {
            MessageBox.Show(this, "请将 PDF 保存到弦作统一工作区内。", "弦作");
            return;
        }
        try
        {
            var print = view.CoreWebView2.Environment.CreatePrintSettings();
            print.PageWidth = 210 / 25.4;
            print.PageHeight = 297 / 25.4;
            print.MarginTop = print.MarginBottom = print.MarginLeft = print.MarginRight = 0;
            print.ShouldPrintHeaderAndFooter = false;
            if (!await view.CoreWebView2.PrintToPdfAsync(picker.FileName, print))
                MessageBox.Show(this, "未能保存六线谱。", "弦作");
        }
        catch (Exception error)
        {
            MessageBox.Show(this, error.Message, "六线谱保存失败");
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Send("pause");
            Hide();
        }
        base.OnFormClosing(e);
    }

    private void RestoreWorkbench()
    {
        if (exiting) return;
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        Send("restore");
    }

    private string SettingsPath => Path.Combine(data, "desktop-settings.json");
    private string ModelDirectory()
    {
        if (workspace is not null) return workspace.Runtime;
        try
        {
            if (File.Exists(SettingsPath))
            {
                string? path = JsonSerializer.Deserialize<string>(File.ReadAllText(SettingsPath));
                if (!string.IsNullOrEmpty(path) && Path.IsPathFullyQualified(path) &&
                    File.Exists(Path.Combine(path, "local-separation", "python", "python.exe"))) return path;
            }
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { }
        string packaged = Path.Combine(AppContext.BaseDirectory, "_internal", "runtime_plugins");
        return Environment.GetEnvironmentVariable("STRINGCRAFT_PLUGIN_DIR")
            ?? (Directory.Exists(packaged) ? packaged : Path.Combine(AppContext.BaseDirectory, "runtime_plugins"));
    }

    private bool ChooseModelDirectory(IWin32Window owner)
    {
        if (workspace is not null)
        {
            OpenPath(workspace.Runtime);
            return false;
        }
        using var picker = new FolderBrowserDialog { Description = "选择包含 local-separation 的 runtime_plugins 目录", SelectedPath = ModelDirectory() };
        if (picker.ShowDialog(owner) != DialogResult.OK) return false;
        if (!File.Exists(Path.Combine(picker.SelectedPath, "local-separation", "python", "python.exe")))
        {
            MessageBox.Show(owner, "此目录没有找到独立模型运行环境。", "模型目录无效");
            return false;
        }
        try
        {
            File.WriteAllText(SettingsPath + ".tmp", JsonSerializer.Serialize(picker.SelectedPath));
            File.Move(SettingsPath + ".tmp", SettingsPath, true);
            Send("models-selected");
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            MessageBox.Show(owner, error.Message, "无法保存模型设置");
            return false;
        }
    }

    private async Task ExitAsync()
    {
        if (exitPending || exiting) return;
        exitPending = true;
        if (workbenchReady)
        {
            saved = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            Send("save-and-exit");
            var result = await Task.WhenAny(saved.Task, Task.Delay(TimeSpan.FromSeconds(10)));
            if (result != saved.Task || !await saved.Task)
            {
                RestoreWorkbench();
                MessageBox.Show(this, "作品暂未保存。请先导出项目或重试退出。", "弦作", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                exitPending = false;
                return;
            }
        }
        exiting = true;
        tray.Visible = false;
        await StopServiceAsync();
        Close();
    }

    private async Task StopServiceAsync()
    {
        if (service is { HasExited: false })
        {
            service.StandardInput.Close();
            await Task.WhenAny(service.WaitForExitAsync(), Task.Delay(3000));
        }
        tree?.Dispose(); // Closing the job also reaps unfinished model descendants.
        tree = null;
        service?.Dispose();
        service = null;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            activation.Unregister(null);
            tray.Visible = false;
            tray.ContextMenuStrip?.Dispose();
            tray.Dispose();
            tree?.Dispose();
            service?.Dispose();
        }
        base.Dispose(disposing);
    }

    private static void OpenPath(string path)
    {
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception error) { MessageBox.Show(error.Message, "无法打开"); }
    }
}
