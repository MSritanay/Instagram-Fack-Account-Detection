import { Button } from "@/components/ui/button";
import { ShieldCheck, MessageSquareWarning, UserX, Lock, ArrowRight } from "lucide-react";
import AnimatedAuthBackground from "@/components/AnimatedAuthBackground";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col font-sans">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-8 w-8 text-primary" />
              <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white">Instagram Authentication</span>
            </div>
            <div className="flex items-center gap-4">
              <Button asChild variant="ghost" className="font-medium">
                <a href="/api/login">Log In</a>
              </Button>
              <Button asChild className="rounded-full px-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25">
                <a href="/api/login">Get Started <ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-20 pb-32 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <AnimatedAuthBackground />
        </div>
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-slate-50 to-white dark:from-slate-900 dark:via-slate-950 dark:to-black opacity-50"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium text-primary mb-8 animate-in fade-in zoom-in duration-500">
            <span className="flex h-2 w-2 rounded-full bg-primary mr-2"></span>
            AI-Powered Threat Detection
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 dark:text-white mb-6 max-w-4xl mx-auto leading-tight animate-in fade-in slide-in-from-bottom-8 duration-700">
            Identify Scams Before <br/> They Strike.
          </h1>
          
          <p className="text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
            Protect yourself from Instagram impersonators and fraudulent messages. Our advanced AI analyzes profiles and texts to detect scam attempts with 99% accuracy.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
            <Button asChild size="lg" className="rounded-full px-8 h-12 text-base shadow-xl shadow-primary/20 hover:scale-105 transition-all">
              <a href="/api/login">Analyze Now for Free</a>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-full px-8 h-12 text-base hover:bg-slate-100 dark:hover:bg-slate-800">
              <a href="#how-it-works">How It Works</a>
            </Button>
          </div>

          {/* Abstract UI representation */}
          <div className="mt-20 relative mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-300">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden p-2">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 p-6 md:p-10">
                 {/* Fake UI content */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                   <div className="space-y-4">
                     <div className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                       <div className="h-10 w-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                         <UserX className="h-5 w-5" />
                       </div>
                       <div>
                         <p className="font-semibold">Suspicious Profile Detected</p>
                         <p className="text-xs text-muted-foreground">High likelihood of impersonation</p>
                       </div>
                       <div className="ml-auto text-rose-600 font-bold">98% Risk</div>
                     </div>
                     <div className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm opacity-60">
                       <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                         <Lock className="h-5 w-5" />
                       </div>
                       <div>
                         <p className="font-semibold">Safe Message</p>
                         <p className="text-xs text-muted-foreground">No malicious intent found</p>
                       </div>
                       <div className="ml-auto text-emerald-600 font-bold">2% Risk</div>
                     </div>
                   </div>
                   
                   <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-6 text-left">
                     <h3 className="font-mono text-sm text-primary mb-2">AI ANALYSIS REPORT</h3>
                     <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                       The analyzed profile exhibits patterns consistent with financial scams. The account age is less than 30 days, yet claims high ROI investment returns.
                     </p>
                     <div className="h-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                       <div className="h-full bg-rose-500 w-[92%]"></div>
                     </div>
                     <div className="flex justify-between mt-2 text-xs font-medium">
                       <span>Risk Score</span>
                       <span className="text-rose-600">CRITICAL</span>
                     </div>
                   </div>
                 </div>
              </div>
            </div>
            
            {/* Decorative background blurs */}
            <div className="absolute -top-20 -left-20 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl -z-10"></div>
            <div className="absolute -bottom-20 -right-20 w-72 h-72 bg-blue-500/20 rounded-full blur-3xl -z-10"></div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="how-it-works" className="py-24 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">Defense in Depth</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
              We combine behavioral analysis with linguistic patterns to uncover threats that traditional filters miss.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 hover:shadow-xl transition-all duration-300">
              <div className="h-12 w-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-6">
                <MessageSquareWarning className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Message Analysis</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Copy and paste DMs to detect phishing links, urgency tactics, and financial fraud keywords instantly.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 hover:shadow-xl transition-all duration-300">
              <div className="h-12 w-12 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center mb-6">
                <UserX className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Profile Verification</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Scan public profile data to spot bot networks, impersonation attempts, and stolen identities.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 hover:shadow-xl transition-all duration-300">
              <div className="h-12 w-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Actionable Reports</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Get clear explanations of why something was flagged, empowering you to make informed decisions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-slate-400" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">Instagram Authentication</span>
          </div>
          <p className="text-sm text-slate-500">Ãƒâ€šÃ‚Â© 2025 Instagram Authentication Defense Systems. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
