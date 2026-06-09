"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CheckCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThermalTicket } from "@/components/ThermalTicket";

interface BetConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  ticketNumber: string;
  stake: number;
  potentialWin: number;
  netPayout: number;
  betsCount: number;
  isOnline: boolean;
  newBalance?: number;
  totalOdds: number;
  stakeTax: number;
  winTax: number;
  betId?: string;
  couponCode?: string;
}

export function BetConfirmationModal({
  open,
  onClose,
  ticketNumber,
  stake,
  potentialWin,
  netPayout,
  betsCount,
  isOnline,
  newBalance,
  totalOdds,
  stakeTax,
  winTax,
  betId,
  couponCode,
}: BetConfirmationModalProps) {
  const buralFromTicket = `088${ticketNumber.replace(/\D/g, "").slice(0, 5).padEnd(5, "0")}`;

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: '1birr.bet Ticket',
        text: `My bet slip: ${ticketNumber}\nStake: ${stake} ETB\nPotential Win: ${netPayout.toFixed(2)} ETB`,
      });
    } else {
      navigator.clipboard.writeText(ticketNumber);
      alert('Ticket number copied to clipboard!');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-gradient-to-b from-gray-900 to-black border-2 border-[var(--mezzo-accent-green)] text-white max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Success Animation Header — `no-print` so only the ticket below is
            sent to the thermal printer when the user hits Ctrl+P. */}
        <div className="no-print relative -mx-6 -mt-6 mb-4 px-6 pt-8 pb-6" style={{ background: "linear-gradient(135deg, var(--mezzo-accent-green) 0%, #4CAF50 100%)" }}>
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: "url('data:image/svg+xml,%3Csvg width=\"60\" height=\"60\" viewBox=\"0 0 60 60\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cg fill=\"none\" fill-rule=\"evenodd\"%3E%3Cg fill=\"%23ffffff\" fill-opacity=\"0.4\"%3E%3Cpath d=\"M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')"
          }}></div>

          <div className="flex flex-col items-center relative z-10">
            <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-4 shadow-lg animate-bounce">
              <CheckCircle className="w-12 h-12 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-black mb-1">
              {isOnline ? "BET PLACED ONLINE!" : "BET PLACED SUCCESSFULLY!"}
            </h2>
            <p className="text-sm text-black/80">Your betting slip has been confirmed</p>
          </div>
        </div>

        {/* Thermal Ticket Preview */}
        <div className="mb-4">
          <ThermalTicket
            ticketNumber={ticketNumber}
            stake={stake}
            totalOdds={totalOdds}
            potentialWin={potentialWin}
            netPayout={netPayout}
            stakeTax={stakeTax}
            winTax={winTax}
            betsCount={betsCount}
            timestamp={new Date().toISOString()}
            buralNumber={buralFromTicket}
          />
        </div>

        {isOnline && (
          <div className="no-print p-3 rounded border border-gray-700 bg-black/40 text-xs space-y-1 mb-3">
            <p>
              <span className="text-gray-400">Coupon Code:</span>{" "}
              <span className="font-semibold text-[var(--mezzo-accent-green)]">
                {couponCode ?? ticketNumber}
              </span>
            </p>
            {betId ? (
              <p>
                <span className="text-gray-400">Bet ID:</span>{" "}
                <span className="font-semibold">{betId}</span>
              </p>
            ) : null}
          </div>
        )}

        {/* Balance Update (Online Only) */}
        {isOnline && newBalance !== undefined && (
          <div className="no-print p-4 rounded-lg border-l-4 border-[var(--mezzo-accent-green)] mb-4" style={{ background: "var(--mezzo-bg-tertiary)" }}>
            <div className="flex justify-between items-center">
              <div>
                <div className="text-xs text-gray-400">Amount Debited</div>
                <div className="text-lg font-bold text-red-400">-{stake} ETB</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">New Balance</div>
                <div className="text-lg font-bold text-[var(--mezzo-accent-green)]">{newBalance.toFixed(2)} ETB</div>
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        {!isOnline && (
          <div className="no-print p-4 rounded-lg mb-4" style={{ background: "rgba(255, 193, 7, 0.1)", border: "1px solid var(--mezzo-accent-yellow)" }}>
            <div className="text-xs text-[var(--mezzo-accent-yellow)] font-semibold mb-2">📍 Next Steps:</div>
            <ul className="text-xs text-gray-300 space-y-1">
              <li>• Visit any 1birr.bet branch or shop</li>
              <li>• Show your ticket number: <span className="font-bold text-white">{ticketNumber}</span></li>
              <li>• Pay {stake} ETB to confirm your bet</li>
              <li>• Keep your receipt safe until results</li>
            </ul>
          </div>
        )}

        {isOnline && (
          <div className="no-print p-4 rounded-lg mb-4" style={{ background: "rgba(76, 175, 80, 0.1)", border: "1px solid var(--mezzo-accent-green)" }}>
            <div className="text-xs text-[var(--mezzo-accent-green)] font-semibold mb-2">✓ What's Next:</div>
            <ul className="text-xs text-gray-300 space-y-1">
              <li>• Your bet is confirmed and active</li>
              <li>• Check Sport History for updates</li>
              <li>• Results will be updated automatically</li>
              <li>• Winnings credited to your account</li>
            </ul>
          </div>
        )}

        {/* Action Buttons — `no-print` keeps these UI controls off the
            thermal printout. Only the ticket itself survives @media print. */}
        <div className="no-print flex gap-2 mb-4">
          <Button
            onClick={handleShare}
            className="flex-1 text-black"
            style={{ background: "var(--mezzo-accent-yellow)" }}
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        </div>

        {/* Close Button */}
        <Button
          onClick={onClose}
          className="no-print w-full text-black font-bold text-lg"
          style={{ background: "var(--mezzo-accent-green)" }}
        >
          DONE
        </Button>

        {/* Footer */}
        <p className="no-print text-center text-xs text-gray-500 mt-4">
          Good luck! 🍀
        </p>
      </DialogContent>
    </Dialog>
  );
}
