export default function Home() {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span>
            Listening<em>Type</em>
          </span>
        </div>
      </header>

      <main>
        <section className="screen setup">
          <div className="hero">
            <p className="eyebrow">Local transcription · sentence practice</p>
            <h1>
              Hear it. <span className="grad">Type it.</span>
              <br />
              Own it.
            </h1>
            <p className="sub">
              Upload a video. Vibe turns the speech into sentences. Then listen and type
              each one, line by line.
            </p>
          </div>

          <div className="dropzone">
            <div className="drop-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="26"
                height="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 16V4" />
                <path d="m6 10 6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
            </div>
            <p className="drop-title">Upload a clip to get started</p>
            <p className="drop-sub">The upload flow is coming in the next commit.</p>
          </div>
        </section>
      </main>
    </>
  );
}
