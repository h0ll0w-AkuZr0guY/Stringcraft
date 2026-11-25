namespace Stringcraft.Desktop;

internal sealed class ManagedWorkspace(string root)
{
    public string Root { get; } = root;
    public string Runtime => Path.Combine(Root, "runtime");
    public string Exports => Path.Combine(Root, "exports");

    public static ManagedWorkspace? Find()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory);
             directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, ".stringcraft-workspace")))
                return new ManagedWorkspace(directory.FullName);
        return null;
    }

    public bool Contains(string path)
    {
        var relative = Path.GetRelativePath(Root, Path.GetFullPath(path));
        return !Path.IsPathRooted(relative) && relative != ".." &&
            !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal);
    }

    public string ExportPath(string suggested)
    {
        Directory.CreateDirectory(Exports);
        string file = Path.GetFileName(suggested);
        string path = Path.Combine(Exports, file.Length == 0 ? "Stringcraft" : file);
        for (int suffix = 2; File.Exists(path); suffix++)
            path = Path.Combine(Exports,
                $"{Path.GetFileNameWithoutExtension(file)} ({suffix}){Path.GetExtension(file)}");
        return path;
    }
}
