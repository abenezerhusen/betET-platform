"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronUp, ChevronDown } from "lucide-react";

const footerLinks = [
  { name: "About US", href: "/about" },
  { name: "Contacts", href: "/contacts" },
  { name: "Rules", href: "/rules" },
  { name: "Privacy Policy", href: "/privacy" },
  { name: "Cookies Policy", href: "/cookies" },
  { name: "Account Rules", href: "/account-rules" },
];

export function Footer() {
  // Always start collapsed on open/refresh so the footer does not cover
  // the betting content. The user can expand it with the toggle button.
  const [isOpen, setIsOpen] = useState(false);

  const toggleFooter = () => {
    setIsOpen(!isOpen);
  };

  return (
    <footer
      className="border-t transition-all duration-300"
      style={{
        background: "linear-gradient(to right, var(--mezzo-bg-tertiary), var(--mezzo-accent-green))",
        borderColor: "var(--mezzo-border)",
      }}
    >
      {/* Hide / Show Footer Toggle */}
      <div className="flex justify-center items-center -mt-4">
        <button
          onClick={toggleFooter}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
          style={{ background: "var(--mezzo-bg-tertiary)" }}
          title={isOpen ? "Hide footer" : "Show footer"}
          aria-expanded={isOpen}
          aria-label={isOpen ? "Hide footer" : "Show footer"}
        >
          {isOpen ? (
            <ChevronDown className="w-5 h-5 text-white" />
          ) : (
            <ChevronUp className="w-5 h-5 text-white" />
          )}
        </button>
      </div>

      {/* Footer Content (hidden when collapsed) */}
      <div
        className={`overflow-hidden transition-all duration-300 ${
          isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="px-6 py-8">
          <div className="flex flex-col items-center gap-6">
            {/* Logo */}
            <img
              src="/play-core-logo.png"
              alt="Play Core"
              className="h-10 w-auto"
            />

            {/* Follow Us */}
            <div className="text-center">
              <h3 className="text-white font-semibold mb-3">Follow Us</h3>
              <Link
                href="https://t.me/playcoresupport"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block hover:scale-110 transition-transform"
              >
                <img
                  src="https://ext.same-assets.com/1203561035/1222657308.svg"
                  alt="Telegram"
                  className="w-8 h-8"
                />
              </Link>
            </div>

            {/* Links */}
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              {footerLinks.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  {link.name}
                </Link>
              ))}
            </div>

            {/* Copyright */}
            <div className="text-center text-xs text-gray-400">
              <p>© {new Date().getFullYear()} Play Core. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
