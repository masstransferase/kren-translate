# Troubleshooting

- **400 Invalid request / thinking or effort unsupported:** choose a compatible level or `Auto`, then retry.
- **401 or 403:** replace the provider key and confirm the key/project has API access.
- **404 model unavailable:** Refresh models or enter a current model ID in KREN Settings.
- **429 quota or rate limit:** check provider quota/billing. KREN uses bounded same-provider backoff; do not raise attempts when a hard quota is exhausted.
- **503 high demand:** retry later or select another model from the same provider. KREN never redirects text to another company.
- **Timeout:** verify connectivity, reduce input size, or increase `kren.request.timeoutMs` within its allowed range.
- **Pronunciation opens KREN on Windows:** native playback failed, was disabled, or the extension is running on a remote host. Confirm `powershell.exe` and Windows media components are available, then check **Windows background pronunciation** in KREN Settings. KREN safely falls back to its webview player.
- **No local TTS voice:** install an OS speech voice and restart VS Code. KREN never silently falls back to Edge Online. Read Aloud requires a local Windows extension host and is hidden in remote, WSL, and non-Windows editor context menus.
- **Read Aloud is silent:** open the KREN gear page, confirm the selected source, choose a detected voice, and use Preview. Confirm Windows audio is not muted. Preview, editor Read Aloud, and rewrite Read Aloud share the same speech settings.
- **Christopher/Ava Edge Online is unavailable:** run `python -m pip install edge-tts` using the same Python command shown in KREN Settings. Try `en-US-ChristopherNeural` or `en-US-AvaNeural`, verify the network connection, and use Preview. Edge Online is experimental because `edge-tts` uses an unofficial Microsoft service interface.
- **Edge Online starts slowly:** KREN launches its hidden player while synthesis runs, but the complete MP3 must still arrive before playback. Shorter selections, a stable connection, and retrying after a service-demand spike can help.
- **Wrong rewrite language:** Rewrite Text normally detects and preserves the source language. For very short or mixed-language text, choose the source language explicitly in KREN Settings and retry.

Never paste API keys into a document, issue, log, screenshot, or support request.

## Windows blue screen after shutdown and startup

KREN does not install a Windows service, startup driver, display driver, or
other kernel component. A Windows blue screen is therefore not an expected
KREN installation result.

If a blue screen names an Intel graphics driver such as `igdkmdn64.sys` and
appears after **Shut down** followed by power-on, but not after **Restart**:

1. Record the stop code and named driver without including API keys or private
   document content.
2. Install the graphics driver and firmware recommended by the computer
   manufacturer for the exact model.
3. In Windows Power Options, disable **Turn on fast startup**, then perform a
   full shutdown and power-on test. This is Windows Fast Startup, not a BIOS
   option that may also be called Fast Boot.
4. Leave Fast Startup disabled if that removes the problem, and report the
   driver failure to the computer or graphics-driver manufacturer.

Windows Fast Startup restores a hibernated kernel and device-driver session.
An ordinary Restart performs a full boot instead. Disabling Fast Startup is a
targeted workaround for a reproduced driver-resume problem, not a general KREN
requirement. If the computer cannot boot normally, use Windows recovery or Safe
Mode and obtain qualified system support before reinstalling extensions.

For Grammar Check:

- If the first check feels slow, wait a few seconds while KREN warms Harper in its background worker. VS Code's main extension host remains responsive.
- If a valid name or technical term is underlined, choose **Quick Fix… > KREN: Add … to local dictionary**.
- To restore ignored findings, run **KREN: Clear Ignored Grammar Findings** or use the matching KREN Settings button.
