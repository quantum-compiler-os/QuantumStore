type Props = {
  authUrl: string;
  waiting: boolean;
  connectError: string;
};

/** What to show after "Connect Daraz" was pressed: where the consent page went, and a link that always works. */
export default function DarazAuthPrompt({ authUrl, waiting, connectError }: Props) {
  return (
    <>
      {connectError && <p className="form-error">{connectError}</p>}
      {authUrl && (
        <p className="muted">
          Daraz opened in a new tab — approve access there with your seller account.{' '}
          {waiting && 'Waiting for approval…'} If no tab opened,{' '}
          <a href={authUrl} target="_blank" rel="noreferrer">
            open the Daraz authorization page
          </a>
          .
        </p>
      )}
    </>
  );
}
