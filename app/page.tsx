import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";

export default function MarketingHome() {
  return (
    <main className="flex-1 flex flex-col pt-12 relative overflow-hidden">
      {/* Glow Effect behind hero */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[800px] h-[400px] bg-primary/20 blur-[120px] rounded-full pointer-events-none -z-10" />
      
      <header className="container relative z-10 flex items-center justify-between py-6">
        <Link href="/" className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center text-black">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          PropertyPilot
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/login" className="text-sm font-medium text-white/80 hover:text-primary transition-colors">
            Login
          </Link>
          <Button asChild size="sm" className="rounded-full shadow-[0_0_15px_rgba(204,255,0,0.3)] hover:shadow-[0_0_25px_rgba(204,255,0,0.5)] transition-all bg-primary text-black hover:bg-primary/90 font-semibold px-6">
            <Link href="/signup">Book a Demo</Link>
          </Button>
        </nav>
      </header>

      <section className="container relative z-10 flex flex-col items-center justify-center py-32 text-center min-h-[70vh]">
        <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-8 backdrop-blur-md">
          <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
          AI For Indian Real Estate
        </div>
        
        <h1 className="text-balance text-6xl font-black tracking-tighter md:text-8xl leading-[1.1] text-white">
          Voice AI that books <br className="hidden md:block"/>
          <span className="text-amber-400">Site Visits</span> automatically.
        </h1>
        
        <p className="mt-8 max-w-2xl text-xl text-white/70 font-medium">
          Stop paying humans to manually dial leads. We build custom Voice AI SDRs that call your leads in Hindi, Marathi, and Tamil to book site visits at ₹95 a head.
        </p>
        
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button asChild size="lg" className="rounded-full h-14 px-8 text-lg bg-primary text-black hover:bg-primary/90 shadow-[0_0_20px_rgba(204,255,0,0.4)] hover:shadow-[0_0_35px_rgba(204,255,0,0.6)] font-bold transition-all w-full sm:w-auto">
            <Link href="/signup">START FREE TRIAL →</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-full h-14 px-8 text-lg border-white/20 bg-white/5 hover:bg-white/10 hover:text-white backdrop-blur-md transition-all w-full sm:w-auto">
            <Link href="#roi">HOW IT WORKS</Link>
          </Button>
        </div>
        
        <div className="mt-20 pt-10 border-t border-white/10 w-full max-w-4xl flex flex-col items-center">
          <p className="text-sm font-semibold text-white/50 mb-6 uppercase tracking-widest">Powering top developers</p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-50 grayscale mix-blend-screen">
            <div className="text-xl font-black text-white flex items-center gap-2"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path><path d="M9 18c-4.51 2-5-2-7-2"></path></svg> Lodha</div>
            <div className="text-xl font-black text-white flex items-center gap-2"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg> Prestige</div>
            <div className="text-xl font-black text-white flex items-center gap-2"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg> Godrej</div>
          </div>
        </div>
      </section>

      <section id="roi" className="container relative z-10 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">The math (50K leads/month)</h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">Compare a traditional tele-calling floor with PropertyPilot&apos;s automated outbound voice agents.</p>
        </div>
        
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <Card className="bg-white/5 border-white/10 backdrop-blur-md rounded-2xl">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-white/90">In-house tele-calling</CardTitle>
              <CardDescription className="text-white/50 text-base">15 SDRs · ₹35K loaded cost</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-black text-white">{formatINR(525_000)}<span className="text-xl text-white/40">/mo</span></div>
              <p className="mt-4 text-sm text-white/60 font-medium">
                ~700 site-visits booked <br/>
                <span className="text-red-400">CPSVB ₹750</span>
              </p>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10 backdrop-blur-md rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-[50px] -mr-10 -mt-10 pointer-events-none"></div>
            <CardHeader>
              <CardTitle className="text-xl font-bold text-white/90 flex justify-between items-start">
                PropertyPilot
                <span className="text-xs px-2 py-1 bg-primary/20 text-primary rounded-full border border-primary/30">AI Powered</span>
              </CardTitle>
              <CardDescription className="text-white/50 text-base">1 ops manager · usage-based</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-black text-white">{formatINR(195_000)}<span className="text-xl text-white/40">/mo</span></div>
              <p className="mt-4 text-sm text-white/60 font-medium">
                ~2,000 site-visits booked <br/>
                <span className="text-primary">CPSVB ₹95</span>
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 backdrop-blur-md rounded-2xl shadow-[0_0_30px_rgba(204,255,0,0.1)]">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-white/90">You save</CardTitle>
              <CardDescription className="text-white/60 text-base">Per month at 50K-lead volume</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-5xl font-black text-primary drop-shadow-[0_0_10px_rgba(204,255,0,0.5)]">{formatINR(330_000)}</div>
              <p className="mt-4 text-base text-white font-medium">
                And book ~3× more site-visits.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="mt-auto border-t border-white/10 bg-black/40 backdrop-blur-md z-10 relative">
        <div className="container flex flex-col md:flex-row items-center justify-between py-8 text-sm text-white/50 font-medium">
          <span>© {new Date().getFullYear()} PropertyPilot · Built for Indian Real Estate</span>
          <div className="flex gap-6 mt-4 md:mt-0">
            <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
            <Link href="https://github.com" className="hover:text-primary transition-colors">GitHub</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
