using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class KeelDesktopLauncher {
    private static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(character);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    [STAThread]
    private static int Main(string[] args) {
        try {
            string root = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            string executable = Path.Combine(root, "out", "Keel-win32-x64", "Keel.exe");
            if (!File.Exists(executable)) throw new FileNotFoundException("请先在工程目录中打包 Keel。", executable);
            var arguments = new StringBuilder();
            foreach (string argument in args) {
                if (arguments.Length > 0) arguments.Append(' ');
                arguments.Append(Quote(argument));
            }
            var start = new ProcessStartInfo(executable, arguments.ToString());
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WorkingDirectory = root;
            start.EnvironmentVariables["KEEL_USER_DATA_PATH"] = Path.Combine(root, ".local-profile");
            using (var process = Process.Start(start)) { }
            return 0;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Keel 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
