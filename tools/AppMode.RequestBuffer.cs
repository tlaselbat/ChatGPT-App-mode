using System;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using System.Diagnostics;

// Transport buffering only. PowerShell's strict parser remains authoritative.
// No window/configuration work or PowerShell runs on a background thread.
public sealed class AppModeBufferedRequest : IDisposable
{
    public readonly TcpClient Client;
    public readonly Task<byte[]> Read;
    private readonly Stopwatch age = Stopwatch.StartNew();
    public bool Expired { get { return age.ElapsedMilliseconds >= 2000; } }
    public AppModeBufferedRequest(TcpClient client) { Client = client; Read = Receive(); }
    private async Task<byte[]> Receive()
    {
        var buffer = new byte[8192 + 4 + 16384];
        int count = 0, headerEnd = -1, expected = -1;
        while (true)
        {
            int previous = count;
            int received = await Client.GetStream().ReadAsync(buffer, count, buffer.Length - count).ConfigureAwait(false);
            if (received == 0) throw new IOException("INCOMPLETE_REQUEST");
            count += received;
            if (headerEnd < 0)
            {
                for (int i = Math.Max(0, previous - 3); i <= count - 4; i++)
                    if (buffer[i] == 13 && buffer[i+1] == 10 && buffer[i+2] == 13 && buffer[i+3] == 10) { headerEnd = i + 4; break; }
                if (headerEnd < 0 && count > 8192 || headerEnd > 8192) throw new IOException("HEADER_LIMIT");
                if (headerEnd >= 0)
                {
                    int length = 0; bool seen = false;
                    foreach (string line in Encoding.ASCII.GetString(buffer, 0, headerEnd).Split(new[] { "\r\n" }, StringSplitOptions.None))
                    {
                        int colon = line.IndexOf(':');
                        if (colon < 0 || !line.Substring(0, colon).Equals("content-length", StringComparison.OrdinalIgnoreCase)) continue;
                        if (seen || !int.TryParse(line.Substring(colon + 1).Trim(), out length) || length < 0 || length > 16384) throw new IOException("BODY_LIMIT");
                        seen = true;
                    }
                    expected = headerEnd + length;
                }
            }
            if (expected >= 0 && count >= expected)
            {
                var result = new byte[expected]; Array.Copy(buffer, result, expected); return result;
            }
            if (count == buffer.Length) throw new IOException("REQUEST_LIMIT");
        }
    }
    public void Dispose() { Client.Close(); }
}
