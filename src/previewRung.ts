/**
 * previewRung.ts — Studio 5000: Preview Rung. Draws the ladder rung at the cursor
 * in the open .rll file and shows it beside the editor. The picture is the editor
 * text, saved or not. Structured Text has no ladder picture.
 */

import * as vscode from 'vscode';
import { RoutineHeader, rungAtLine } from './export/routineFile';
import { renderRungSvg } from './export/rungPreview';
import { log } from './log';

let panel: vscode.WebviewPanel | undefined;

function whereOf(header: RoutineHeader, number: number): string {
  const owner = header.aoi ? `AOI ${header.aoi}` : (header.program ?? '');
  const loc = [owner, header.routine].filter(Boolean).join('/');
  return `${loc}  rung ${number}`;
}

function page(svg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{margin:0;padding:12px;background:var(--vscode-editor-background);}</style>
</head><body>${svg}</body></html>`;
}

function show(title: string, svg: string): void {
  if (!panel) {
    panel = vscode.window.createWebviewPanel('studio5000.rungPreview', title, vscode.ViewColumn.Beside, { enableScripts: false });
    panel.onDidDispose(() => { panel = undefined; });
  } else {
    panel.title = title;
    panel.reveal(vscode.ViewColumn.Beside);
  }
  panel.webview.html = page(svg);
}

export function registerPreviewRung(): vscode.Disposable {
  const command = vscode.commands.registerCommand('studio5000.previewRung', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'rll') {
      void vscode.window.showInformationMessage('Studio 5000: Preview Rung works on a ladder routine (.rll). Put the cursor on the rung.');
      return;
    }
    const hit = rungAtLine(editor.document.getText(), editor.selection.active.line);
    if (hit.rung === undefined) {
      const msg = hit.reason === 'st'
        ? 'Structured Text has no ladder preview.'
        : 'Put the cursor on a rung to preview it.';
      void vscode.window.showInformationMessage(`Studio 5000: ${msg}`);
      return;
    }
    const where = whereOf(hit.header, hit.rung.number);
    show(`Rung ${hit.rung.number} · ${hit.header.routine || 'ladder'}`, renderRungSvg(hit.rung.text, { comment: hit.rung.comment, where }));
    log('OPEN', `rung preview ${where}`);
  });
  return vscode.Disposable.from(command, new vscode.Disposable(() => panel?.dispose()));
}
