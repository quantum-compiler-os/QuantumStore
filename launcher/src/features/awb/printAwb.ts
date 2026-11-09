const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Prints label markup (see AwbLabel, whose styles travel inside it) on 120 × 170 mm pages, the size Daraz's Leopards
 * AWB uses, from a hidden frame so nothing else on the admin page is printed. Several labels print one per page.
 * The frame holds only the label's own markup (rendered by React, so order text is escaped) and no scripts.
 * Resolves once the print dialog has been opened.
 */
export function printAwbMarkup(labels: string[], title: string) {
  return new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden',
    });

    const pages = labels.map((label) => `<div class="awb-sheet">${label}</div>`).join('');
    frame.srcdoc =
      '<!doctype html><html><head><meta charset="utf-8">' +
      `<title>${escapeHtml(title)}</title>` +
      '<style>@page{size:120mm 170mm;margin:0}html,body{margin:0;padding:0;background:#fff}' +
      '.awb-sheet{width:120mm;height:170mm;overflow:hidden;break-after:page;page-break-after:always}' +
      '.awb-sheet:last-child{break-after:auto;page-break-after:auto}</style>' +
      `</head><body>${pages}</body></html>`;

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      frame.remove();
    };

    frame.addEventListener(
      'load',
      () => {
        const win = frame.contentWindow;
        if (!win) {
          remove();
          reject(new Error('The print window could not be opened'));
          return;
        }
        win.addEventListener('afterprint', () => setTimeout(remove, 0));
        // Fallback for browsers that never report the dialog closing.
        setTimeout(remove, 5 * 60 * 1000);
        win.focus();
        win.print();
        resolve();
      },
      { once: true },
    );
    document.body.appendChild(frame);
  });
}
