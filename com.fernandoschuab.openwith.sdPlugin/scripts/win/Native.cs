// Código nativo usado pelo openwith.ps1 (Windows).
// Compatível com o compilador C# 5 do Windows PowerShell 5.1 (sem "out var", "$" strings, "?.", etc.).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace OpenWithNative
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct COMDLG_FILTERSPEC
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pszName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pszSpec;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct NativeSize
    {
        public int cx;
        public int cy;
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItemArray
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);
        void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
        void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
        void GetAttributes(int attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
        void GetCount(out uint pdwNumItems);
        void GetItemAt(uint dwIndex, out IShellItem ppsi);
        void EnumItems(out IntPtr ppenumShellItems);
    }

    // IModalWindow -> IFileDialog -> IFileOpenDialog (a ordem dos métodos importa).
    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr hwndOwner);
        void SetFileTypes(uint cFileTypes, [MarshalAs(UnmanagedType.LPArray)] COMDLG_FILTERSPEC[] rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IShellItemArray ppenum);
        void GetSelectedItems(out IShellItemArray ppsai);
    }

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    public class FileOpenDialogCoClass
    {
    }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(NativeSize size, int flags, out IntPtr phbm);
    }

    public static class Shell
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        private static extern void SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            IntPtr pbc,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out object ppv);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr hObject);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        private const uint FOS_NOCHANGEDIR = 0x8;
        private const uint FOS_PICKFOLDERS = 0x20;
        private const uint FOS_FORCEFILESYSTEM = 0x40;
        private const uint FOS_ALLOWMULTISELECT = 0x200;
        private const uint FOS_PATHMUSTEXIST = 0x800;
        private const uint FOS_FILEMUSTEXIST = 0x1000;
        private const uint SIGDN_FILESYSPATH = 0x80058000;
        private const int HR_CANCELLED = unchecked((int)0x800704C7);
        private const int SIIGBF_BIGGERSIZEOK = 0x1;
        private const int SIIGBF_ICONONLY = 0x4;

        /// <summary>Seletor nativo do Explorer. Retorna os caminhos escolhidos (vazio se cancelado).</summary>
        public static string[] Pick(IntPtr owner, bool folders, bool multiple, string title, string initialDir, string filterName, string filterSpec)
        {
            IFileOpenDialog dlg = (IFileOpenDialog)new FileOpenDialogCoClass();
            try
            {
                uint opts;
                dlg.GetOptions(out opts);
                opts |= FOS_NOCHANGEDIR | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
                opts |= folders ? FOS_PICKFOLDERS : FOS_FILEMUSTEXIST;
                if (multiple) opts |= FOS_ALLOWMULTISELECT;
                dlg.SetOptions(opts);

                if (!String.IsNullOrEmpty(title)) dlg.SetTitle(title);

                if (!folders && !String.IsNullOrEmpty(filterSpec))
                {
                    COMDLG_FILTERSPEC spec = new COMDLG_FILTERSPEC();
                    spec.pszName = String.IsNullOrEmpty(filterName) ? filterSpec : filterName;
                    spec.pszSpec = filterSpec;
                    dlg.SetFileTypes(1, new COMDLG_FILTERSPEC[] { spec });
                }

                if (!String.IsNullOrEmpty(initialDir))
                {
                    try
                    {
                        object item;
                        SHCreateItemFromParsingName(initialDir, IntPtr.Zero, typeof(IShellItem).GUID, out item);
                        dlg.SetFolder((IShellItem)item);
                    }
                    catch (Exception)
                    {
                        // pasta inicial inválida: ignora
                    }
                }

                int hr = dlg.Show(owner);
                if (hr == HR_CANCELLED) return new string[0];
                if (hr != 0) Marshal.ThrowExceptionForHR(hr);

                IShellItemArray results;
                dlg.GetResults(out results);
                uint count;
                results.GetCount(out count);
                List<string> list = new List<string>();
                for (uint i = 0; i < count; i++)
                {
                    IShellItem item;
                    results.GetItemAt(i, out item);
                    string path;
                    item.GetDisplayName(SIGDN_FILESYSPATH, out path);
                    if (!String.IsNullOrEmpty(path)) list.Add(path);
                }
                return list.ToArray();
            }
            finally
            {
                Marshal.ReleaseComObject(dlg);
            }
        }

        /// <summary>Salva o ícone (com transparência) de um arquivo/programa como PNG.</summary>
        public static bool SaveIcon(string path, string outPng, int size)
        {
            IntPtr hbm = IntPtr.Zero;
            try
            {
                object obj;
                SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out obj);
                IShellItemImageFactory factory = (IShellItemImageFactory)obj;
                NativeSize sz = new NativeSize();
                sz.cx = size;
                sz.cy = size;
                int hr = factory.GetImage(sz, SIIGBF_BIGGERSIZEOK | SIIGBF_ICONONLY, out hbm);
                if (hr != 0 || hbm == IntPtr.Zero) return false;

                using (Bitmap src = ToArgb(hbm))
                using (Bitmap dst = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                using (Graphics g = Graphics.FromImage(dst))
                {
                    g.Clear(Color.Transparent);
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    g.DrawImage(src, new Rectangle(0, 0, size, size));
                    dst.Save(outPng, ImageFormat.Png);
                }
                return true;
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                if (hbm != IntPtr.Zero) DeleteObject(hbm);
            }
        }

        // Image.FromHbitmap descarta o canal alfa; relemos os bytes como ARGB pré-multiplicado.
        private static Bitmap ToArgb(IntPtr hbm)
        {
            using (Bitmap src = Image.FromHbitmap(hbm))
            {
                if (Image.GetPixelFormatSize(src.PixelFormat) != 32) return new Bitmap(src);

                Rectangle rect = new Rectangle(0, 0, src.Width, src.Height);
                BitmapData data = src.LockBits(rect, ImageLockMode.ReadOnly, src.PixelFormat);
                try
                {
                    int length = Math.Abs(data.Stride) * data.Height;
                    byte[] bytes = new byte[length];
                    Marshal.Copy(data.Scan0, bytes, 0, length);
                    bool hasAlpha = false;
                    for (int i = 3; i < length; i += 4)
                    {
                        if (bytes[i] != 0) { hasAlpha = true; break; }
                    }
                    if (!hasAlpha) return new Bitmap(src);

                    using (Bitmap wrapped = new Bitmap(data.Width, data.Height, data.Stride, PixelFormat.Format32bppPArgb, data.Scan0))
                    {
                        Bitmap copy = new Bitmap(data.Width, data.Height, PixelFormat.Format32bppArgb);
                        using (Graphics g = Graphics.FromImage(copy))
                        {
                            g.Clear(Color.Transparent);
                            g.DrawImage(wrapped, 0, 0, data.Width, data.Height);
                        }
                        return copy;
                    }
                }
                finally
                {
                    src.UnlockBits(data);
                }
            }
        }
    }
}
