import React, { useState, useEffect, useId, useCallback } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  AlertOctagon,
  Info,
  Loader2,
  X,
  Lock,
  FileText,
} from 'lucide-react';

/**
 * P22.25-A: Centralized Risk Classification Framework
 */
export type DestructiveRiskTier = 'LOW' | 'DESTRUCTIVE' | 'HIGH_RISK' | 'CRITICAL';

export interface DestructiveActionGuardModalProps {
  /**
   * Modal visibility state
   */
  isOpen: boolean;

  /**
   * Risk tier classification determining safety friction and verification requirements
   */
  riskTier: DestructiveRiskTier;

  /**
   * Clear, non-generic title of the operation (e.g. "Cancel Match Dispatch", "Revoke Administrator Role")
   */
  title: string;

  /**
   * Name or identifier of the entity being acted upon (e.g. "Match #104 (Ring 1)", "Coach Juan Dela Cruz")
   */
  targetEntityName?: string;

  /**
   * Summary description of the intended action
   */
  description: string;

  /**
   * Explicit, unambiguous description of the operational impact and consequences
   */
  consequence?: string;

  /**
   * Indicates whether the action can be undone
   * Default: false (treated as irreversible or operationally disruptive)
   */
  isReversible?: boolean;

  /**
   * Custom explicit label for the confirm button (e.g. "Cancel Dispatch", "Revoke Role", "Apply Forfeit")
   * Default derived from riskTier (e.g. "Confirm Critical Action", "Confirm Action")
   */
  confirmButtonText?: string;

  /**
   * Custom label for cancel/abort button
   * Default: "Keep Unchanged"
   */
  cancelButtonText?: string;

  /**
   * If provided, or if required by risk tier, user must type this exact string to enable confirmation.
   * For CRITICAL tier, typed confirmation is mandatory (defaults to 'CONFIRM' if empty or not provided).
   */
  requiredConfirmationText?: string;

  /**
   * If true, requires the operator to provide an explanation/reason for audit logging.
   * NOTE: For CRITICAL risk tier, this is MANDATORY and cannot be disabled by passing false.
   */
  requireReason?: boolean;

  /**
   * Placeholder prompt for the reason input field
   */
  reasonPlaceholder?: string;

  /**
   * Cancel / Close handler (guaranteed 0 mutations)
   */
  onCancel: () => void;

  /**
   * Authoritative mutation trigger. Invoked strictly once upon explicit confirmation.
   * Can be asynchronous; modal manages internal isExecuting state to prevent duplicate clicks.
   */
  onConfirm: (reason?: string) => Promise<void> | void;
}

const RISK_CONFIG: Record<
  DestructiveRiskTier,
  {
    badgeLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    borderClass: string;
    headerBgClass: string;
    buttonClass: string;
  }
> = {
  LOW: {
    badgeLabel: 'OPERATIONAL CONFIRMATION',
    icon: Info,
    accentColor: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    headerBgClass: 'bg-amber-500/10',
    buttonClass: 'bg-amber-600 hover:bg-amber-500 text-white focus:ring-amber-400',
  },
  DESTRUCTIVE: {
    badgeLabel: 'DESTRUCTIVE ACTION',
    icon: AlertTriangle,
    accentColor: 'text-amber-400',
    borderClass: 'border-amber-500/40',
    headerBgClass: 'bg-amber-500/15',
    buttonClass: 'bg-amber-600 hover:bg-amber-500 text-white focus:ring-amber-400',
  },
  HIGH_RISK: {
    badgeLabel: 'HIGH-RISK OPERATION',
    icon: ShieldAlert,
    accentColor: 'text-rose-400',
    borderClass: 'border-rose-500/50',
    headerBgClass: 'bg-rose-950/40',
    buttonClass: 'bg-rose-600 hover:bg-rose-500 text-white focus:ring-rose-400',
  },
  CRITICAL: {
    badgeLabel: 'CRITICAL / IRREVERSIBLE OPERATION',
    icon: AlertOctagon,
    accentColor: 'text-rose-400',
    borderClass: 'border-rose-600/70',
    headerBgClass: 'bg-rose-950/60',
    buttonClass: 'bg-rose-600 hover:bg-rose-500 text-white focus:ring-rose-400 shadow-lg shadow-rose-950/50',
  },
};

/**
 * P22.25-A: Centralized Destructive Action Guard Modal
 * Ensures rigorous human-intent verification, explicit consequence acknowledgment,
 * typed confirmation barriers, duplicate-submit protection, and zero unintended mutations.
 */
export const DestructiveActionGuardModal: React.FC<DestructiveActionGuardModalProps> = ({
  isOpen,
  riskTier,
  title,
  targetEntityName,
  description,
  consequence,
  isReversible = false,
  confirmButtonText,
  cancelButtonText = 'Keep Unchanged',
  requiredConfirmationText,
  requireReason,
  reasonPlaceholder = 'Provide operational justification for audit trail (required)...',
  onCancel,
  onConfirm,
}) => {
  const [typedInput, setTypedInput] = useState<string>('');
  const [reasonInput, setReasonInput] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const titleId = useId();
  const descId = useId();

  // Enforce mandatory reason for CRITICAL tier (caller cannot bypass via requireReason={false})
  const isReasonRequired = riskTier === 'CRITICAL' ? true : Boolean(requireReason);

  // Enforce mandatory typed confirmation for CRITICAL tier (defaults to 'CONFIRM' if empty)
  const effectiveRequiredText =
    riskTier === 'CRITICAL'
      ? (requiredConfirmationText && requiredConfirmationText.trim().length > 0
          ? requiredConfirmationText.trim()
          : 'CONFIRM')
      : (requiredConfirmationText && requiredConfirmationText.trim().length > 0
          ? requiredConfirmationText.trim()
          : undefined);

  const needsTypedMatch = Boolean(effectiveRequiredText);

  // Reset form inputs whenever modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setTypedInput('');
      setReasonInput('');
      setIsExecuting(false);
      setErrorMessage(null);
    }
  }, [isOpen]);

  // Handle ESC key dismiss (safe cancel with zero mutations)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || isExecuting) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExecuting, onCancel]);

  // Validation logic determining confirm button enablement
  const isTypedMatchValid = !needsTypedMatch || (effectiveRequiredText !== undefined && typedInput.trim() === effectiveRequiredText);
  const isReasonValid = !isReasonRequired || reasonInput.trim().length >= 4;
  const isConfirmEnabled = isTypedMatchValid && isReasonValid && !isExecuting;

  const handleConfirmSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isConfirmEnabled || isExecuting) return;

    setIsExecuting(true);
    setErrorMessage(null);

    try {
      await onConfirm(reasonInput.trim() || undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred during execution.';
      setErrorMessage(msg);
      setIsExecuting(false);
    }
  }, [isConfirmEnabled, isExecuting, onConfirm, reasonInput]);

  if (!isOpen) return null;

  const config = RISK_CONFIG[riskTier] || RISK_CONFIG.DESTRUCTIVE;
  const IconComponent = config.icon;

  const defaultButtonLabel =
    riskTier === 'CRITICAL'
      ? 'Confirm Critical Action'
      : riskTier === 'HIGH_RISK'
      ? 'Confirm High-Risk Action'
      : 'Confirm Action';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        className={`w-full max-w-lg bg-slate-900 border ${config.borderClass} rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto transition-all`}
      >
        {/* Modal Header */}
        <div className={`p-4 sm:p-5 ${config.headerBgClass} border-b border-slate-800 flex items-start justify-between gap-3`}>
          <div className="flex items-start space-x-3 min-w-0">
            <div className={`p-2 rounded-xl bg-slate-950/70 border border-slate-800 ${config.accentColor} shrink-0 mt-0.5`}>
              <IconComponent className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-extrabold uppercase tracking-wider ${config.accentColor} bg-slate-950/60 border border-slate-800`}>
                  {config.badgeLabel}
                </span>
                {!isReversible && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider text-rose-400 bg-rose-950/40 border border-rose-900/50">
                    IRREVERSIBLE
                  </span>
                )}
              </div>
              <h3 id={titleId} className="text-base sm:text-lg font-bold text-white mt-1 break-words">
                {title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={isExecuting}
            aria-label="Close dialog without changes"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleConfirmSubmit} className="p-4 sm:p-5 space-y-4 text-xs sm:text-sm text-slate-300">
          {/* Target Entity Callout (if provided) */}
          {targetEntityName && (
            <div className="px-3.5 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center space-x-2.5">
              <span className="text-[11px] font-mono text-slate-500 uppercase font-bold tracking-wider shrink-0">
                Target:
              </span>
              <span className="font-semibold text-white truncate text-xs sm:text-sm">
                {targetEntityName}
              </span>
            </div>
          )}

          {/* Description */}
          <div id={descId} className="space-y-2 text-slate-300">
            <p className="leading-relaxed break-words">{description}</p>
          </div>

          {/* Explicit Consequence Box */}
          {consequence && (
            <div className="p-3 sm:p-3.5 bg-rose-950/20 border border-rose-900/40 rounded-xl space-y-1">
              <div className="flex items-center space-x-1.5 text-rose-400 font-bold text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Operational Impact & Consequences:</span>
              </div>
              <p className="text-xs text-rose-200/90 leading-relaxed break-words pl-5">
                {consequence}
              </p>
            </div>
          )}

          {/* Reason Input Field (if required) */}
          {isReasonRequired && (
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <span>Operational Reason for Audit Trail <span className="text-rose-400">*</span></span>
              </label>
              <textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                disabled={isExecuting}
                rows={2}
                placeholder={reasonPlaceholder}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-50 resize-none"
              />
              {reasonInput.trim().length > 0 && reasonInput.trim().length < 4 && (
                <span className="text-[11px] text-amber-400 font-mono">
                  Minimum 4 characters required for audit validation.
                </span>
              )}
            </div>
          )}

          {/* Typed Confirmation Barrier (if required) */}
          {effectiveRequiredText && (
            <div className="space-y-1.5 p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl">
              <label className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5 text-rose-400" />
                <span>
                  Type <span className="font-mono text-rose-400 bg-rose-950/50 px-1.5 py-0.5 rounded border border-rose-900/50">{effectiveRequiredText}</span> to confirm intent:
                </span>
              </label>
              <input
                type="text"
                value={typedInput}
                onChange={(e) => setTypedInput(e.target.value)}
                disabled={isExecuting}
                placeholder={`Type "${effectiveRequiredText}" exactly`}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs sm:text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors disabled:opacity-50"
              />
            </div>
          )}

          {/* Error Banner (if execution failed) */}
          {errorMessage && (
            <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl flex items-start space-x-2 text-rose-200 text-xs animate-in fade-in">
              <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <span className="font-bold block">Execution Failed:</span>
                <span className="break-words">{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Modal Footer / Action Buttons */}
          <div className="pt-2 flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={isExecuting}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-xl font-bold text-xs sm:text-sm transition-all min-h-[40px] flex items-center justify-center disabled:opacity-50 cursor-pointer"
            >
              {cancelButtonText}
            </button>

            <button
              type="submit"
              disabled={!isConfirmEnabled}
              className={`w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all min-h-[40px] flex items-center justify-center space-x-2 focus:outline-none focus:ring-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${config.buttonClass}`}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Processing Confirmation...</span>
                </>
              ) : (
                <span>{confirmButtonText || defaultButtonLabel}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
