import { useState } from 'react';

type Props = {
  /** Set once "Connect Daraz" opened the consent page in this page session. */
  authUrl: string;
  waiting: boolean;
  connectError: string;
  finishing: boolean;
  /** The callback URL the Launcher sends to Daraz; it must equal the one registered in the Daraz app. */
  redirectUri: string | null | undefined;
  /** Show the paste box even without a fresh Connect, so a code from an earlier approval is never stranded. */
  showPaste: boolean;
  onFinish: (input: string) => void;
};

/** What to show around "Connect Daraz": where the consent page went, a link that always works, and the manual finish. */
export default function DarazAuthPrompt({
  authUrl,
  waiting,
  connectError,
  finishing,
  redirectUri,
  showPaste,
  onFinish,
}: Props) {
  const [pasted, setPasted] = useState('');

  return (
    <>
      {connectError && <p className="form-error">{connectError}</p>}
      {authUrl && (
        <p className="muted" style={{ margin: 0 }}>
          Daraz opened in a new tab — approve access there with your seller account. {waiting && 'Waiting for approval… '}
          If no tab opened,{' '}
          <a href={authUrl} target="_blank" rel="noreferrer">
            open the Daraz authorization page
          </a>
          .
        </p>
      )}
      {(authUrl || showPaste) && redirectUri && (
        <p className="muted" style={{ margin: 0 }}>
          Daraz sends you back to <code>{redirectUri}</code>. If Daraz says &ldquo;Redirect uri does not match the callback
          url of the APP&rdquo;, register exactly that address as your app&apos;s callback URL, or set{' '}
          <code>DARAZ_REDIRECT_URI</code> in <code>launcher/.env</code> to the callback your app already has.
        </p>
      )}
      {(authUrl || showPaste) && (
        <label>
          Approved on Daraz and landed on another page? Paste the code, or the whole address Daraz sent you to (it
          contains <code>?code=…</code>). Codes are single-use and expire after 30 minutes.
          <div className="admin-quick">
            <input
              className="input"
              placeholder="https://…?code=…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={finishing || !pasted.trim()}
              onClick={() => onFinish(pasted)}
            >
              {finishing ? 'Connecting…' : 'Finish connecting'}
            </button>
          </div>
        </label>
      )}
    </>
  );
}
