using System;
using System.Drawing;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BillingClient
{
    public partial class Form1 : Form
    {
        private ClientWebSocket? ws;
        private string pcName = "PC-01";
        private System.Windows.Forms.Timer? sessionTimer;
        private System.Windows.Forms.Timer? clockTimer;
        private int remainingSeconds = 0;
        private CancellationTokenSource? cts;

        // UI Controls Bersih & Minimalis
        private Label lblClock = null!;
        private Label lblDate = null!;
        private Label lblPcTitle = null!;
        private Label lblStatusBadge = null!;
        private Label lblTimerCountdown = null!;
        private Label lblInstruction = null!;
        private Panel centerCard = null!;

        public Form1()
        {
            InitializeComponent();
            SetupCleanUI();
            SetupTimers();
            _ = ConnectToServerAsync();
        }

        private void SetupCleanUI()
        {
            // Fullscreen borderless, background abu-abu gelap minimalis (tidak norak/ramai)
            this.FormBorderStyle = FormBorderStyle.None;
            this.WindowState = FormWindowState.Maximized;
            this.TopMost = true;
            this.BackColor = Color.FromArgb(15, 23, 42); // Slate 900
            this.DoubleBuffered = true;

            // Jam di pojok kanan atas
            int screenWidth = Screen.PrimaryScreen?.Bounds.Width ?? 1920;
            int screenHeight = Screen.PrimaryScreen?.Bounds.Height ?? 1080;

            lblClock = new Label
            {
                Text = DateTime.Now.ToString("HH:mm:ss"),
                ForeColor = Color.FromArgb(248, 250, 252),
                Font = new Font("Segoe UI", 26, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(screenWidth - 260, 36)
            };
            this.Controls.Add(lblClock);

            lblDate = new Label
            {
                Text = DateTime.Now.ToString("dddd, dd MMM yyyy"),
                ForeColor = Color.FromArgb(148, 163, 184),
                Font = new Font("Segoe UI", 11, FontStyle.Regular),
                AutoSize = true,
                Location = new Point(screenWidth - 260, 82)
            };
            this.Controls.Add(lblDate);

            // Kotak Tengah (Card Elegan)
            int cardW = 520;
            int cardH = 340;
            int startX = (screenWidth - cardW) / 2;
            int startY = (screenHeight - cardH) / 2;

            centerCard = new Panel
            {
                Size = new Size(cardW, cardH),
                Location = new Point(startX, startY),
                BackColor = Color.FromArgb(30, 41, 59) // Slate 800
            };
            this.Controls.Add(centerCard);

            // Nama PC
            lblPcTitle = new Label
            {
                Text = pcName,
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 28, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(36, 32)
            };
            centerCard.Controls.Add(lblPcTitle);

            // Badge Status Terkunci
            lblStatusBadge = new Label
            {
                Text = "KOMPUTER TERKUNCI",
                ForeColor = Color.FromArgb(226, 232, 240),
                BackColor = Color.FromArgb(51, 65, 85),
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                AutoSize = true,
                Padding = new Padding(8, 4, 8, 4),
                Location = new Point(40, 90)
            };
            centerCard.Controls.Add(lblStatusBadge);

            // Box Sisa Waktu
            Panel timerPanel = new Panel
            {
                Size = new Size(440, 85),
                Location = new Point(40, 130),
                BackColor = Color.FromArgb(15, 23, 42)
            };
            centerCard.Controls.Add(timerPanel);

            Label lblTimerLabel = new Label
            {
                Text = "SISA WAKTU",
                ForeColor = Color.FromArgb(148, 163, 184),
                Font = new Font("Segoe UI", 8, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(16, 12)
            };
            timerPanel.Controls.Add(lblTimerLabel);

            lblTimerCountdown = new Label
            {
                Text = "--:--:--",
                ForeColor = Color.FromArgb(248, 250, 252),
                Font = new Font("Consolas", 28, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(14, 30)
            };
            timerPanel.Controls.Add(lblTimerCountdown);

            // Petunjuk ke kasir
            lblInstruction = new Label
            {
                Text = "Silakan hubungi kasir untuk memulai sesi bermain.",
                ForeColor = Color.FromArgb(148, 163, 184),
                Font = new Font("Segoe UI", 10, FontStyle.Regular),
                AutoSize = true,
                Location = new Point(40, 240)
            };
            centerCard.Controls.Add(lblInstruction);

            Label lblEsc = new Label
            {
                Text = "Tekan ESC untuk keluar (mode teknisi/admin).",
                ForeColor = Color.FromArgb(100, 116, 139),
                Font = new Font("Segoe UI", 8, FontStyle.Regular),
                AutoSize = true,
                Location = new Point(40, 290)
            };
            centerCard.Controls.Add(lblEsc);
        }

        private void SetupTimers()
        {
            clockTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            clockTimer.Tick += (s, e) =>
            {
                lblClock.Text = DateTime.Now.ToString("HH:mm:ss");
                lblDate.Text = DateTime.Now.ToString("dddd, dd MMM yyyy");
            };
            clockTimer.Start();

            sessionTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            sessionTimer.Tick += SessionTimer_Tick;
        }

        private void SessionTimer_Tick(object? sender, EventArgs e)
        {
            if (remainingSeconds > 0)
            {
                remainingSeconds--;
                UpdateTimerDisplay();
            }
            else
            {
                sessionTimer?.Stop();
                LockScreenAction();
            }
        }

        private void UpdateTimerDisplay()
        {
            int hours = remainingSeconds / 3600;
            int minutes = (remainingSeconds % 3600) / 60;
            int seconds = remainingSeconds % 60;

            string timeStr = $"{hours:D2}:{minutes:D2}:{seconds:D2}";

            Action updateAction = () => {
                lblTimerCountdown.Text = timeStr;
            };

            if (lblTimerCountdown.InvokeRequired)
            {
                lblTimerCountdown.Invoke(updateAction);
            }
            else
            {
                updateAction();
            }
        }

        private async Task ConnectToServerAsync()
        {
            while (true)
            {
                try
                {
                    ws = new ClientWebSocket();
                    cts = new CancellationTokenSource();
                    await ws.ConnectAsync(new Uri("ws://localhost:3000"), cts.Token);

                    string regJson = "{\"event\": \"register_pc\", \"pcName\": \"" + pcName + "\"}";
                    byte[] regBytes = Encoding.UTF8.GetBytes(regJson);
                    await ws.SendAsync(new ArraySegment<byte>(regBytes), WebSocketMessageType.Text, true, cts.Token);

                    var buffer = new byte[2048];
                    while (ws.State == WebSocketState.Open)
                    {
                        var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                        }
                        else
                        {
                            string message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                            HandleServerMessage(message);
                        }
                    }
                }
                catch
                {
                    await Task.Delay(3000);
                }
            }
        }

        private void HandleServerMessage(string jsonMessage)
        {
            try
            {
                if (jsonMessage.Contains("unlock_pc"))
                {
                    int duration = ExtractIntField(jsonMessage, "duration");
                    remainingSeconds = duration > 0 ? duration : 3600;

                    this.Invoke((MethodInvoker)delegate {
                        sessionTimer?.Start();
                        this.Hide();
                    });
                }
                else if (jsonMessage.Contains("lock_pc"))
                {
                    LockScreenAction();
                }
                else if (jsonMessage.Contains("add_time"))
                {
                    int addSecs = ExtractIntField(jsonMessage, "additionalSeconds");
                    remainingSeconds += addSecs;
                    this.Invoke((MethodInvoker)delegate {
                        MessageBox.Show($"Waktu bermain ditambah {addSecs / 60} menit oleh Kasir.", "Informasi Billing", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    });
                }
                else if (jsonMessage.Contains("popup_message"))
                {
                    string msg = ExtractStringField(jsonMessage, "message");
                    this.Invoke((MethodInvoker)delegate {
                        MessageBox.Show(msg, "Pesan dari Kasir", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    });
                }
            }
            catch { }
        }

        private int ExtractIntField(string json, string field)
        {
            try
            {
                int keyIdx = json.IndexOf($"\"{field}\"");
                if (keyIdx != -1)
                {
                    int colonIdx = json.IndexOf(":", keyIdx);
                    int commaIdx = json.IndexOf(",", colonIdx);
                    if (commaIdx == -1) commaIdx = json.IndexOf("}", colonIdx);

                    string valStr = json.Substring(colonIdx + 1, commaIdx - colonIdx - 1).Trim();
                    if (int.TryParse(valStr, out int val)) return val;
                }
            }
            catch { }
            return 0;
        }

        private string ExtractStringField(string json, string field)
        {
            try
            {
                int keyIdx = json.IndexOf($"\"{field}\"");
                if (keyIdx != -1)
                {
                    int colonIdx = json.IndexOf(":", keyIdx);
                    int startQuote = json.IndexOf("\"", colonIdx);
                    int endQuote = json.IndexOf("\"", startQuote + 1);
                    return json.Substring(startQuote + 1, endQuote - startQuote - 1);
                }
            }
            catch { }
            return "";
        }

        private void LockScreenAction()
        {
            this.Invoke((MethodInvoker)delegate {
                sessionTimer?.Stop();
                remainingSeconds = 0;
                lblTimerCountdown.Text = "--:--:--";
                this.TopMost = true;
                this.WindowState = FormWindowState.Maximized;
                this.Show();
            });
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.KeyCode == Keys.Escape)
            {
                if (ws != null && ws.State == WebSocketState.Open)
                {
                    cts?.Cancel();
                }
                Application.Exit();
            }
        }
    }
}
