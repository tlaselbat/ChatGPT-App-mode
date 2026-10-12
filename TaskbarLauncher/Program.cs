using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Shell;
using System.Web.Script.Serialization;

namespace ChatGPTTaskbarLauncher
{
    internal static class Program
    {
        private const string AppUserModelId = "OpenAI.ChatGPT.AppMode";

        private static readonly Dictionary<string, string> ScriptActions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "--app", "Launch-ChatGPT-AppMode.ps1" },
            { "--new-session", "Launch-ChatGPT-AppMode.ps1" },
            { "--normal", "Open-Chromium-Normal.ps1" },
            { "--topmost", "Launch-ChatGPT-TopMost.ps1" },
            { "--tray", "Start-ChatGPT-TrayLauncher.ps1" },
            { "--config", "Open-Config.ps1" },
            { "--extension", "Open-Extension-Folder.ps1" },
            { "--toggle-extension", "Toggle-LocalExtension.ps1" },
            { "--reset-profile", "Reset-Portable-Chromium-Profile.ps1" },
        };

        [STAThread]
        private static int Main(string[] args)
        {
            SetCurrentProcessExplicitAppUserModelID(AppUserModelId);

            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            RegisterJumpList(app);

            var command = args.Length > 0 ? args[0] : (IsControlKeyDown() ? "--new-session" : "--app");
            if (command.Equals("--create-shortcut", StringComparison.OrdinalIgnoreCase))
            {
                CreateShortcut();
                return 0;
            }

            if (command.Equals("--register-only", StringComparison.OrdinalIgnoreCase))
            {
                return 0;
            }

            if (command.Equals("--recent-chat", StringComparison.OrdinalIgnoreCase))
            {
                return OpenRecentChat(args);
            }

            string scriptName;
            if (!ScriptActions.TryGetValue(command, out scriptName))
            {
                MessageBox.Show(
                    "Unknown launcher command: " + command,
                    "ChatGPT Taskbar Launcher",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return 1;
            }

            var scriptPath = Path.Combine(GetAppRoot(), scriptName);
            if (!File.Exists(scriptPath))
            {
                MessageBox.Show(
                    "The launcher could not find:\n" + scriptPath,
                    "ChatGPT Taskbar Launcher",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
                return 1;
            }

            StartPowerShellScript(scriptPath, command.Equals("--new-session", StringComparison.OrdinalIgnoreCase) ? "-NewSession" : null);
            return 0;
        }

        private static int OpenRecentChat(string[] args)
        {
            if (args.Length < 2)
            {
                return 1;
            }

            int index;
            if (!int.TryParse(args[1], out index))
            {
                return 1;
            }

            var recentChats = ReadRecentChats();
            if (index < 0 || index >= recentChats.Count)
            {
                return 1;
            }

            var scriptPath = Path.Combine(GetAppRoot(), "Launch-ChatGPT-AppMode.ps1");
            if (!File.Exists(scriptPath))
            {
                MessageBox.Show(
                    "The launcher could not find:\n" + scriptPath,
                    "ChatGPT Taskbar Launcher",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
                return 1;
            }

            StartPowerShellScript(scriptPath, "-Url " + QuotePowerShellString(recentChats[index].url));
            return 0;
        }

        private static string GetAppRoot()
        {
            var executableDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var executableDirectoryInfo = new DirectoryInfo(executableDir);
            var parent = executableDirectoryInfo.Parent;

            if (executableDirectoryInfo.Name.Equals("TaskbarLauncher", StringComparison.OrdinalIgnoreCase))
            {
                return parent != null ? parent.FullName : executableDir;
            }

            if (Directory.Exists(Path.Combine(executableDir, "Browser")))
            {
                return executableDir;
            }

            return Path.GetFullPath(Path.Combine(executableDir, "..", "..", ".."));
        }

        private static void CreateShortcut()
        {
            var appRoot = GetAppRoot();
            var shortcutsDir = Path.Combine(appRoot, "shortcuts");
            Directory.CreateDirectory(shortcutsDir);

            var shortcutPaths = new[]
            {
                Path.Combine(shortcutsDir, "ChatGPT Taskbar Launcher.lnk"),
            };
            var exePath = Process.GetCurrentProcess().MainModule.FileName;
            var iconPath = Path.Combine(appRoot, "assets", "OpenAI-white.ico");

            foreach (var shortcutPath in shortcutPaths)
            {
                if (File.Exists(shortcutPath))
                {
                    File.Delete(shortcutPath);
                }

                IShellLinkW shellLink = (IShellLinkW)new CShellLink();
                shellLink.SetPath(exePath);
                shellLink.SetWorkingDirectory(appRoot);
                shellLink.SetDescription("ChatGPT app mode launcher");
                shellLink.SetIconLocation(File.Exists(iconPath) ? iconPath : exePath, 0);

                var propertyStore = (IPropertyStore)shellLink;
                var appUserModelId = PropertyKeys.AppUserModelId;
                var appId = PropVariant.FromString(AppUserModelId);
                try
                {
                    propertyStore.SetValue(ref appUserModelId, ref appId);
                    propertyStore.Commit();
                }
                finally
                {
                    appId.Dispose();
                }

                ((IPersistFile)shellLink).Save(shortcutPath, true);
                SetShortcutFileAppUserModelId(shortcutPath);
            }
        }

        private static void SetShortcutFileAppUserModelId(string shortcutPath)
        {
            var propertyStoreId = typeof(IPropertyStore).GUID;
            IPropertyStore propertyStore;
            SHGetPropertyStoreFromParsingName(shortcutPath, IntPtr.Zero, 0x2, ref propertyStoreId, out propertyStore);

            var appId = PropVariant.FromString(AppUserModelId);
            try
            {
                var appUserModelId = PropertyKeys.AppUserModelId;
                propertyStore.SetValue(ref appUserModelId, ref appId);
                propertyStore.Commit();
            }
            finally
            {
                appId.Dispose();
            }
        }

        private static void RegisterJumpList(Application app)
        {
            var exePath = Process.GetCurrentProcess().MainModule.FileName;
            if (string.IsNullOrWhiteSpace(exePath))
            {
                return;
            }

            var jumpList = new JumpList
            {
                ShowRecentCategory = false,
                ShowFrequentCategory = false,
            };

            AddTask(jumpList, exePath, "Open ChatGPT", "--app", "Launch ChatGPT in app mode");
            AddTask(jumpList, exePath, "New Chat", "--new-session", "Launch ChatGPT without restoring the last chat URL");

            var recentChats = ReadRecentChats();
            for (var i = 0; i < recentChats.Count && i < 3; i++)
            {
                var title = string.IsNullOrWhiteSpace(recentChats[i].title) ? "Recent: Chat " + (i + 1) : "Recent: " + recentChats[i].title;
                AddTask(jumpList, exePath, title, "--recent-chat " + i, "Open this recent ChatGPT conversation");
            }

            JumpList.SetJumpList(app, jumpList);
            jumpList.Apply();
        }

        private static void AddTask(JumpList jumpList, string exePath, string title, string arguments, string description, string customCategory = null)
        {
            jumpList.JumpItems.Add(new JumpTask
            {
                Title = title,
                Arguments = arguments,
                Description = description,
                ApplicationPath = exePath,
                IconResourcePath = exePath,
                IconResourceIndex = 0,
                CustomCategory = customCategory,
            });
        }

        private static List<RecentChat> ReadRecentChats()
        {
            var recentChatsPath = Path.Combine(GetAppRoot(), "logs", "recent-chats.json");
            if (!File.Exists(recentChatsPath))
            {
                return new List<RecentChat>();
            }

            try
            {
                var json = File.ReadAllText(recentChatsPath);
                var serializer = new JavaScriptSerializer();
                var items = serializer.Deserialize<List<RecentChat>>(json) ?? new List<RecentChat>();
                var validItems = new List<RecentChat>();

                foreach (var item in items)
                {
                    if (item != null && IsChatGptUrl(item.url))
                    {
                        validItems.Add(item);
                    }

                    if (validItems.Count >= 3)
                    {
                        break;
                    }
                }

                return validItems;
            }
            catch
            {
                return new List<RecentChat>();
            }
        }

        private static bool IsChatGptUrl(string url)
        {
            return !string.IsNullOrWhiteSpace(url) &&
                (url.StartsWith("https://chatgpt.com/", StringComparison.OrdinalIgnoreCase) ||
                 url.StartsWith("https://chat.openai.com/", StringComparison.OrdinalIgnoreCase));
        }

        private static string QuotePowerShellString(string value)
        {
            return "'" + value.Replace("'", "''") + "'";
        }

        private sealed class RecentChat
        {
            public string url { get; set; }
            public string title { get; set; }
            public string savedAt { get; set; }
        }

        private static bool IsControlKeyDown()
        {
            return (GetAsyncKeyState(0x11) & 0x8000) != 0;
        }

        private static void StartPowerShellScript(string scriptPath, string scriptArguments)
        {
            var arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"";
            if (!string.IsNullOrWhiteSpace(scriptArguments))
            {
                arguments += " " + scriptArguments;
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = arguments,
                WorkingDirectory = Path.GetDirectoryName(scriptPath) ?? AppDomain.CurrentDomain.BaseDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
            });
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        private static extern void SetCurrentProcessExplicitAppUserModelID(string appId);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int virtualKey);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        private static extern void SHGetPropertyStoreFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            IntPtr pbc,
            uint flags,
            ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ppv);

        [ComImport]
        [Guid("00021401-0000-0000-C000-000000000046")]
        private class CShellLink
        {
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("000214F9-0000-0000-C000-000000000046")]
        private interface IShellLinkW
        {
            void GetPath(IntPtr pszFile, int cchMaxPath, IntPtr pfd, uint fFlags);
            void GetIDList(out IntPtr ppidl);
            void SetIDList(IntPtr pidl);
            void GetDescription(IntPtr pszName, int cchMaxName);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetWorkingDirectory(IntPtr pszDir, int cchMaxPath);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
            void GetArguments(IntPtr pszArgs, int cchMaxPath);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
            void GetHotkey(out short pwHotkey);
            void SetHotkey(short wHotkey);
            void GetShowCmd(out int piShowCmd);
            void SetShowCmd(int iShowCmd);
            void GetIconLocation(IntPtr pszIconPath, int cchIconPath, out int piIcon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
            void Resolve(IntPtr hwnd, uint fFlags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("0000010B-0000-0000-C000-000000000046")]
        private interface IPersistFile
        {
            void GetClassID(out Guid pClassID);
            void IsDirty();
            void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
            void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
            void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
            void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        private interface IPropertyStore
        {
            void GetCount(out uint cProps);
            void GetAt(uint iProp, out PropertyKey pkey);
            void GetValue(ref PropertyKey key, out PropVariant pv);
            void SetValue(ref PropertyKey key, ref PropVariant pv);
            void Commit();
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        private struct PropertyKey
        {
            public Guid FormatId;
            public uint PropertyId;

            public PropertyKey(Guid formatId, uint propertyId)
            {
                FormatId = formatId;
                PropertyId = propertyId;
            }
        }

        private static class PropertyKeys
        {
            public static readonly PropertyKey AppUserModelId = new PropertyKey(
                new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
                5);
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PropVariant : IDisposable
        {
            private ushort valueType;
            private ushort reserved1;
            private ushort reserved2;
            private ushort reserved3;
            private IntPtr value;
            private IntPtr value2;

            public static PropVariant FromString(string text)
            {
                return new PropVariant
                {
                    valueType = 31,
                    value = Marshal.StringToCoTaskMemUni(text),
                    value2 = IntPtr.Zero
                };
            }

            public void Dispose()
            {
                if (value != IntPtr.Zero)
                {
                    Marshal.FreeCoTaskMem(value);
                    value = IntPtr.Zero;
                }
            }
        }
    }
}
