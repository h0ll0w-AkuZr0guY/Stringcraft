using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Stringcraft.Desktop;

internal static class RuntimeArchive
{
    private static byte[] Coordinate(string value) =>
        Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/') + "=");

    public static string Install(string archivePath, string directory)
    {
        using var input = new FileStream(archivePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length is <= 0 or > 8L * 1024 * 1024 * 1024)
            throw new InvalidDataException("CUDA 包大小无效。");
        var sigFile = new FileInfo(archivePath + ".sig");
        if (!sigFile.Exists || sigFile.Length != 64) throw new InvalidDataException("缺少 CUDA 包签名 .sig。");
        var signature = File.ReadAllBytes(sigFile.FullName);
        string digest = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
        using var key = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint {
                X = Coordinate("w5hlF0utBhUKNrk_sJwqZIt_WUqANtbD4P3zXWheEjA"),
                Y = Coordinate("FoouSegLvYCqgi5FpQaEoi_Oyf8quj_y47XbUTEYTcg"),
            },
        });
        if (!key.VerifyData(Encoding.ASCII.GetBytes(digest), signature, HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
            throw new InvalidDataException("CUDA 包的发行签名不匹配。");

        Directory.CreateDirectory(directory);
        string target = Path.Combine(directory, digest);
        if (File.Exists(Path.Combine(target, ".verified-runtime"))) return digest;
        string stage = Path.Combine(directory, ".stage-" + Guid.NewGuid().ToString("N"));
        string prefix = Path.GetFullPath(stage) + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(stage);
        try
        {
            input.Position = 0;
            using var zip = new ZipArchive(input, ZipArchiveMode.Read);
            long expanded = 0;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in zip.Entries)
            {
                string name = entry.FullName;
                if (!name.StartsWith("local-separation/", StringComparison.Ordinal) ||
                    name.Split('/').Any(segment => segment is "" or "." or ".." ||
                        segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
                    throw new InvalidDataException("CUDA 包包含无效路径。");
                string output = Path.GetFullPath(Path.Combine(stage, name));
                expanded = checked(expanded + entry.Length);
                if (!output.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !seen.Add(output) ||
                    expanded > 12L * 1024 * 1024 * 1024 || seen.Count > 60000)
                    throw new InvalidDataException("CUDA 包的内容超过限制。");
                Directory.CreateDirectory(Path.GetDirectoryName(output)!);
                entry.ExtractToFile(output);
            }
            string runtime = Path.Combine(stage, "local-separation");
            using var manifest = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(runtime, "runtime.json")));
            if (manifest.RootElement.GetProperty("device").GetString() != "cu124" ||
                !File.Exists(Path.Combine(runtime, "python", "python.exe")) ||
                !File.Exists(Path.Combine(runtime, "bin", "ffmpeg.exe")))
                throw new InvalidDataException("CUDA 包的运行环境不完整。");
            File.WriteAllText(Path.Combine(stage, ".verified-runtime"), digest);
            Directory.Move(stage, target);
            return digest;
        }
        catch
        {
            try { Directory.Delete(stage, recursive: true); } catch (IOException) { }
            throw;
        }
    }
}
