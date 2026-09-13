import Link from "next/link";
import PdfToolDirectory from "../../components/pdf-tool-directory";
import PdfPrivacyStrip from "../../components/pdf-privacy-strip";
import PdfToolsInstall from "../../components/pdf-tools-install";

export default function PdfToolsPage() {
  return (
    <div className="pdf-page">
      <section className="pdf-tools-section" aria-labelledby="pdf-tools-title">
        <div className="pdf-tools-heading">
          <div>
            <h1 id="pdf-tools-title">PDF Tools</h1>
            <PdfPrivacyStrip />
          </div>
          <PdfToolsInstall />
        </div>
        <PdfToolDirectory />
      </section>

      <footer className="site-footer">
        <p><Link href="/">← Back to DearPDF home</Link></p>
        <p>For sensitive official documents, always verify the downloaded result before sharing.</p>
      </footer>
    </div>
  );
}
