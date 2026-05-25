"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, Phone, Mail } from "lucide-react"

export function LobbyFooter() {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="mt-8">
      {/* Toggle Tab */}
      <div className="flex justify-center">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="bg-pink-500 hover:bg-pink-600 px-6 sm:px-8 md:px-10 py-2 sm:py-3 md:py-4 rounded-t-lg transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-5 sm:w-6 md:w-7 h-5 sm:h-6 md:h-7 text-white" />
          ) : (
            <ChevronUp className="w-5 sm:w-6 md:w-7 h-5 sm:h-6 md:h-7 text-white" />
          )}
        </button>
      </div>

      {/* Footer Content */}
      {isExpanded && (
        <div className="bg-[#0d1117] border-t border-slate-700/50 px-4 sm:px-6 md:px-8 lg:px-10 py-4 sm:py-6 md:py-8 lg:py-10">
          <div className="w-full mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8 lg:gap-10" style={{ maxWidth: 'min(100%, 1920px)' }}>
            {/* About */}
            <div className="min-w-0">
              <h3 className="text-slate-300 font-semibold mb-2 sm:mb-3 md:mb-4 tracking-wide text-sm sm:text-base md:text-lg">ABOUT THE COMPANY</h3>
              <p className="text-slate-500 text-sm sm:text-base break-words">Play Core ©2026</p>
            </div>

            {/* Important Links */}
            <div className="min-w-0">
              <h3 className="text-slate-300 font-semibold mb-2 sm:mb-3 md:mb-4 tracking-wide text-sm sm:text-base md:text-lg">IMPORTANT LINKS</h3>
              <ul className="space-y-1 sm:space-y-2 md:space-y-3">
                <li>
                  <a href="#" className="text-cyan-400 hover:text-cyan-300 text-sm sm:text-base transition-colors break-words">
                    HOW TO BET
                  </a>
                </li>
                <li>
                  <a href="#" className="text-cyan-400 hover:text-cyan-300 text-sm sm:text-base transition-colors break-words">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="#" className="text-cyan-400 hover:text-cyan-300 text-sm sm:text-base transition-colors break-words">
                    Terms and Conditions
                  </a>
                </li>
                <li>
                  <a href="#" className="text-cyan-400 hover:text-cyan-300 text-sm sm:text-base transition-colors break-words">
                    Responsible Gambling
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div className="min-w-0">
              <h3 className="text-slate-300 font-semibold mb-2 sm:mb-3 md:mb-4 tracking-wide text-sm sm:text-base md:text-lg">Legal and compliance</h3>
              <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 md:mb-4">
                <div className="w-8 sm:w-10 md:w-12 h-8 sm:h-10 md:h-12 rounded-full border-2 border-red-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-red-500 text-xs sm:text-sm md:text-base font-bold">18+</span>
                </div>
              </div>
              <p className="text-slate-500 text-sm sm:text-base break-words">Version 1.0.5</p>
            </div>

            {/* Contact */}
            <div className="min-w-0">
              <h3 className="text-slate-300 font-semibold mb-2 sm:mb-3 md:mb-4 tracking-wide text-sm sm:text-base md:text-lg">REACH US</h3>
              <div className="space-y-1 sm:space-y-2 md:space-y-3">
                <a href="tel:" className="flex items-center gap-2 text-slate-400 hover:text-slate-300 transition-colors">
                  <Phone className="w-4 sm:w-5 md:w-6 h-4 sm:h-5 md:h-6 flex-shrink-0" />
                </a>
                <a href="mailto:" className="flex items-center gap-2 text-slate-400 hover:text-slate-300 transition-colors">
                  <Mail className="w-4 sm:w-5 md:w-6 h-4 sm:h-5 md:h-6 flex-shrink-0" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
