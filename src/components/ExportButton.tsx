import { useState } from 'react';
import { saveTextToFile } from '../api/tauri';

interface ExportButtonProps {
  fileName: string;
  content: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Replace the browser `Blob + <a download>` pattern (a silent no-op inside
 * Tauri's WebView2): routes the text to a Rust-side native save dialog + file
 * write, and surfaces the saved path / error inline.
 */
export function ExportButton({ fileName, content, label = 'Export', className = 'ctx-item', disabled }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState('');

  const doExport = async () => {
    if (exporting || !content) return;
    setExporting(true);
    setMsg('');
    try {
      const res = await saveTextToFile(fileName, content);
      if (res !== 'cancelled') {
        setMsg(`Saved → ${res}`);
      }
    } catch (e) {
      setMsg(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <button
        className={className}
        onClick={doExport}
        disabled={disabled || exporting || !content}
        title="导出为本地文件（原生保存对话框）"
      >
        {exporting ? 'Exporting…' : label}
      </button>
      {msg && <span className="export-msg">{msg}</span>}
    </>
  );
}