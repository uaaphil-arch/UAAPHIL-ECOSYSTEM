import React, { useState, useMemo } from 'react';
import { X, Layers, Plus, Trash2, AlertCircle, Loader2, Info } from 'lucide-react';
import { tournamentService } from '../../services/tournamentService';
import { Tournament, TournamentSnapshot, TournamentEvent, EventWeightClassItem } from '../../types/tournament';
import {
  ARNIS_EVENT_REGISTRY,
  CANONICAL_DIVISIONS,
  INDIVIDUAL_DIVISIONS,
  TEAM_DIVISIONS,
  CanonicalDivision,
  deriveGenderFromDivision,
  WeightClassConfig
} from '../../constants/arnisRegistry';

interface EventConfigurationModalProps {
  isOpen: boolean;
  tournament: Tournament | null;
  snapshot: TournamentSnapshot | null;
  events: TournamentEvent[];
  onClose: () => void;
  onRefreshEvents: () => void;
}

export const EventConfigurationModal: React.FC<EventConfigurationModalProps> = ({
  isOpen,
  tournament,
  snapshot,
  events,
  onClose,
  onRefreshEvents,
}) => {
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState<'ANYO' | 'FULL_CONTACT'>('ANYO');
  const [category, setCategory] = useState<string>(ARNIS_EVENT_REGISTRY.disciplines.ANYO.categories[0].name);
  const [division, setDivision] = useState<CanonicalDivision>('Junior Male');
  const [level, setLevel] = useState<string>('NONE');
  
  // Full Contact specifics (Multi-weight support)
  const [isOpenWeight, setIsOpenWeight] = useState(false);
  const [weightClasses, setWeightClasses] = useState<WeightClassConfig[]>([
    { name: '', min_weight: null, max_weight: null, requires_weigh_in: true }
  ]);
  const [openWeightRequiresWeighIn, setOpenWeightRequiresWeighIn] = useState<boolean>(false);
  const [bracketModel, setBracketModel] = useState<string>('SINGLE_ELIMINATION_TWO_BRONZE');

  // Anyo specifics
  const [panelSize, setPanelSize] = useState<'5_JUDGES' | '7_JUDGES'>('5_JUDGES');
  const [calcMethod, setCalcMethod] = useState<'OLYMPIC_TRIM' | 'ARITHMETIC_MEAN' | 'STANDARD_MEAN'>('OLYMPIC_TRIM');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if current category is a Team Anyo category
  const selectedAnyoCategory = useMemo(() => {
    return ARNIS_EVENT_REGISTRY.disciplines.ANYO.categories.find(c => c.name === category) || null;
  }, [category]);

  const isTeamCategory = discipline === 'ANYO' && selectedAnyoCategory?.type === 'TEAM';

  // Allowed divisions based on category type
  const availableDivisions = useMemo(() => {
    if (discipline === 'ANYO') {
      return isTeamCategory ? TEAM_DIVISIONS : INDIVIDUAL_DIVISIONS;
    }
    return INDIVIDUAL_DIVISIONS;
  }, [discipline, isTeamCategory]);

  if (!isOpen || !tournament || !snapshot) return null;

  const isReadOnly = tournament.status === 'ONGOING' || tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED';

  const handleDisciplineChange = (newDiscipline: 'ANYO' | 'FULL_CONTACT') => {
    setDiscipline(newDiscipline);
    const firstCat = newDiscipline === 'ANYO'
      ? ARNIS_EVENT_REGISTRY.disciplines.ANYO.categories[0].name
      : ARNIS_EVENT_REGISTRY.disciplines.FULL_CONTACT.categories[0].name;
    setCategory(firstCat);
    setDivision('Junior Male');

    if (newDiscipline === 'ANYO') {
      setIsOpenWeight(false);
    } else {
      setWeightClasses([
        { name: '', min_weight: null, max_weight: null, requires_weigh_in: true }
      ]);
    }
  };

  const handleCategoryChange = (newCategory: string) => {
    setCategory(newCategory);
    if (discipline === 'ANYO') {
      const catObj = ARNIS_EVENT_REGISTRY.disciplines.ANYO.categories.find(c => c.name === newCategory);
      if (catObj?.type === 'INDIVIDUAL' && (division === 'Mixed Junior' || division === 'Mixed Senior')) {
        setDivision('Junior Male');
      }
    }
  };

  const handleOpenWeightToggle = (checked: boolean) => {
    setIsOpenWeight(checked);
    if (!checked && weightClasses.length === 0) {
      setWeightClasses([{ name: '', min_weight: null, max_weight: null, requires_weigh_in: true }]);
    }
  };

  const handleAddWeightClass = () => {
    setWeightClasses(prev => [
      ...prev,
      { name: '', min_weight: null, max_weight: null, requires_weigh_in: true }
    ]);
  };

  const handleRemoveWeightClass = (index: number) => {
    setWeightClasses(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateWeightClass = (index: number, field: keyof WeightClassConfig, value: unknown) => {
    setWeightClasses(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const validateWeightClasses = (): string | null => {
    if (discipline !== 'FULL_CONTACT' || isOpenWeight) return null;

    if (weightClasses.length === 0) {
      return 'Please add at least one weight class for non-open-weight Full Contact events.';
    }

    const seenNames = new Set<string>();

    for (let i = 0; i < weightClasses.length; i++) {
      const wc = weightClasses[i];
      const trimmedName = wc.name.trim();
      if (!trimmedName) {
        return `Weight class #${i + 1} must have a name.`;
      }
      const lowerName = trimmedName.toLowerCase();
      if (seenNames.has(lowerName)) {
        return `Duplicate weight class name "${trimmedName}". Each weight class must have a unique name.`;
      }
      seenNames.add(lowerName);

      if (wc.min_weight !== null && isNaN(wc.min_weight)) {
        return `Weight class "${trimmedName}" has an invalid minimum weight.`;
      }
      if (wc.max_weight !== null && isNaN(wc.max_weight)) {
        return `Weight class "${trimmedName}" has an invalid maximum weight.`;
      }
      if (wc.min_weight !== null && wc.max_weight !== null && wc.min_weight > wc.max_weight) {
        return `Weight class "${trimmedName}" minimum weight (${wc.min_weight} kg) cannot be greater than maximum weight (${wc.max_weight} kg).`;
      }
    }

    // Overlap validation for defined numeric ranges
    for (let i = 0; i < weightClasses.length; i++) {
      const a = weightClasses[i];
      if (a.min_weight === null || a.max_weight === null) continue;

      for (let j = i + 1; j < weightClasses.length; j++) {
        const b = weightClasses[j];
        if (b.min_weight === null || b.max_weight === null) continue;

        // Check range overlap: (minA <= maxB) and (minB <= maxA) with exclusive boundaries (allow adjacent e.g. 50-55 and 55.01-60)
        if (a.min_weight < b.max_weight && b.min_weight < a.max_weight) {
          return `Overlapping weight ranges detected between "${a.name}" (${a.min_weight}–${a.max_weight} kg) and "${b.name}" (${b.min_weight}–${b.max_weight} kg).`;
        }
      }
    }

    return null;
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setError(null);

    if (!name.trim() || !category.trim() || !division.trim()) {
      setError('Please fill in required event parameters.');
      return;
    }

    const isAnyo = discipline === 'ANYO';

    // Validation for Full Contact Weight Classes
    if (!isAnyo && !isOpenWeight) {
      const weightValidationError = validateWeightClasses();
      if (weightValidationError) {
        setError(weightValidationError);
        return;
      }
    }

    // Automatically derive gender from division
    const derivedGender = deriveGenderFromDivision(division);

    const cleanWeightClasses: EventWeightClassItem[] = isAnyo
      ? []
      : isOpenWeight
      ? [{ name: 'Open Weight', min_weight: null, max_weight: null, requires_weigh_in: openWeightRequiresWeighIn }]
      : weightClasses.map(wc => ({
          name: wc.name.trim(),
          min_weight: wc.min_weight,
          max_weight: wc.max_weight,
          requires_weigh_in: wc.requires_weigh_in,
        }));

    // Primary/backward-compatible single weight_class summary string
    const primaryWeightClassName = isAnyo
      ? 'N/A'
      : isOpenWeight
      ? 'Open Weight'
      : cleanWeightClasses.length === 1
      ? cleanWeightClasses[0].name
      : `${cleanWeightClasses.length} Weight Classes (${cleanWeightClasses.map(w => w.name).join(', ')})`;

    const rulesOverride: Record<string, unknown> = {
      level: level === 'NONE' ? null : level,
      requires_weigh_in: isAnyo ? false : (isOpenWeight ? openWeightRequiresWeighIn : cleanWeightClasses.some(w => w.requires_weigh_in)),
      weight_classes: cleanWeightClasses,
      // Backward-compatible scalar min/max if exactly 1 weight class
      min_weight: !isAnyo && !isOpenWeight && cleanWeightClasses.length === 1 ? cleanWeightClasses[0].min_weight : null,
      max_weight: !isAnyo && !isOpenWeight && cleanWeightClasses.length === 1 ? cleanWeightClasses[0].max_weight : null,
    };

    if (isAnyo) {
      rulesOverride.panel_size = panelSize;
      rulesOverride.calc_method = calcMethod;
    } else {
      rulesOverride.bracket_model = bracketModel;
      rulesOverride.is_open_weight = isOpenWeight;
    }

    setIsSubmitting(true);
    try {
      await tournamentService.createEvent({
        snapshot_id: snapshot.id, // STRICT SNAPSHOT BINDING
        name: name.trim(),
        category: category.trim(),
        division: division,
        weight_class: primaryWeightClassName,
        gender: derivedGender, // Automatically derived from division
        rules_override: rulesOverride,
      });

      setName('');
      if (!isAnyo && !isOpenWeight) {
        setWeightClasses([{ name: '', min_weight: null, max_weight: null, requires_weigh_in: true }]);
      }
      onRefreshEvents();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create event.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (isReadOnly) return;
    setDeletingId(id);
    setError(null);
    try {
      await tournamentService.deleteEvent(id);
      onRefreshEvents();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete event.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Arnis Event Configuration</h2>
              <p className="text-xs text-slate-400">
                Bound to Snapshot Version {snapshot.version} (<span className="font-mono text-amber-400">{snapshot.id.slice(0, 8)}...</span>)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-lg flex items-start gap-2 text-red-200 text-sm">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isReadOnly ? (
            <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-lg text-xs text-amber-200 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Tournament is <strong>{tournament.status}</strong>. Event configuration is strictly locked and immutable.</span>
            </div>
          ) : (
            <form onSubmit={handleCreateEvent} className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Add New Arnis Event
                </h3>
                {/* Discipline Toggle */}
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => handleDisciplineChange('ANYO')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      discipline === 'ANYO'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Anyo (Forms)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisciplineChange('FULL_CONTACT')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      discipline === 'FULL_CONTACT'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Full Contact (Sparring)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Event Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={discipline === 'ANYO' ? "e.g., Team Solo Baston - Mixed Senior" : "e.g., Full Contact Live Stick - Men's"}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-hidden focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Category / Ruleset *</label>
                  <select
                    value={category}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-hidden focus:border-amber-400 font-medium"
                  >
                    {discipline === 'ANYO' ? (
                      ARNIS_EVENT_REGISTRY.disciplines.ANYO.categories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name} ({c.type})
                        </option>
                      ))
                    ) : (
                      ARNIS_EVENT_REGISTRY.disciplines.FULL_CONTACT.categories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Division (Encodes Gender) *
                    {isTeamCategory && <span className="text-[10px] text-amber-400 ml-1.5 font-normal">(Team Mixed supported)</span>}
                  </label>
                  <select
                    value={division}
                    onChange={(e) => setDivision(e.target.value as CanonicalDivision)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-hidden focus:border-amber-400"
                  >
                    {availableDivisions.map((div) => {
                      const g = deriveGenderFromDivision(div);
                      const gLabel = g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Mixed';
                      return (
                        <option key={div} value={div}>
                          {div} ({gLabel})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Level (Optional)</label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-hidden focus:border-amber-400"
                  >
                    {ARNIS_EVENT_REGISTRY.levels.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl === 'NONE' ? 'None / Open Level' : lvl}
                      </option>
                    ))}
                  </select>
                </div>

                {discipline === 'ANYO' ? (
                  <>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Panel Size</label>
                      <select
                        value={panelSize}
                        onChange={(e) => setPanelSize(e.target.value as '5_JUDGES' | '7_JUDGES')}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-hidden focus:border-amber-400"
                      >
                        <option value="5_JUDGES">5 Judges Panel</option>
                        <option value="7_JUDGES">7 Judges Panel</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Calculation Mode</label>
                      <select
                        value={calcMethod}
                        onChange={(e) => setCalcMethod(e.target.value as 'OLYMPIC_TRIM' | 'ARITHMETIC_MEAN' | 'STANDARD_MEAN')}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-hidden focus:border-amber-400"
                      >
                        {ARNIS_EVENT_REGISTRY.anyoCalculationModes.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — {m.description}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Bracket Elimination Format</label>
                      <select
                        value={bracketModel}
                        onChange={(e) => setBracketModel(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-hidden focus:border-amber-400"
                      >
                        {ARNIS_EVENT_REGISTRY.fullContactBracketModels.map((bm) => (
                          <option key={bm.id} value={bm.id}>
                            {bm.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Full Contact Multi-Weight Configuration Section */}
                    <div className="sm:col-span-2 p-4 bg-slate-900/90 border border-slate-800 rounded-lg space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                            Weight Classes Configuration
                          </label>
                          <p className="text-[11px] text-slate-400">
                            Configure one or multiple weight divisions for this Full Contact event
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                          <input
                            type="checkbox"
                            checked={isOpenWeight}
                            onChange={(e) => handleOpenWeightToggle(e.target.checked)}
                            className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
                          />
                          <span>Open Weight Event (No Weight Limits)</span>
                        </label>
                      </div>

                      {isOpenWeight ? (
                        <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-md flex items-center justify-between">
                          <div className="text-xs text-slate-300">
                            <span className="font-medium text-amber-400">Open Weight:</span> Athletes of any weight may register without weight boundary validation.
                          </div>
                          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={openWeightRequiresWeighIn}
                              onChange={(e) => setOpenWeightRequiresWeighIn(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
                            />
                            <span>Require Official Weigh-In</span>
                          </label>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-400 uppercase">
                              Configured Classes ({weightClasses.length})
                            </span>
                            <button
                              type="button"
                              onClick={handleAddWeightClass}
                              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded text-xs font-semibold flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add Weight Class</span>
                            </button>
                          </div>

                          <div className="space-y-2.5">
                            {weightClasses.map((wc, idx) => (
                              <div
                                key={idx}
                                className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center"
                              >
                                <div className="sm:col-span-4">
                                  <label className="block text-[10px] text-slate-400 mb-0.5">
                                    Class Name *
                                  </label>
                                  <input
                                    type="text"
                                    required
                                    value={wc.name}
                                    onChange={(e) => handleUpdateWeightClass(idx, 'name', e.target.value)}
                                    placeholder="e.g. -55 kg, Featherweight"
                                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:border-amber-400 focus:outline-hidden"
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <label className="block text-[10px] text-slate-400 mb-0.5">
                                    Min (kg)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={wc.min_weight !== null ? wc.min_weight : ''}
                                    onChange={(e) =>
                                      handleUpdateWeightClass(
                                        idx,
                                        'min_weight',
                                        e.target.value === '' ? null : parseFloat(e.target.value)
                                      )
                                    }
                                    placeholder="e.g. 50"
                                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:border-amber-400 focus:outline-hidden"
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <label className="block text-[10px] text-slate-400 mb-0.5">
                                    Max (kg)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={wc.max_weight !== null ? wc.max_weight : ''}
                                    onChange={(e) =>
                                      handleUpdateWeightClass(
                                        idx,
                                        'max_weight',
                                        e.target.value === '' ? null : parseFloat(e.target.value)
                                      )
                                    }
                                    placeholder="e.g. 55"
                                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:border-amber-400 focus:outline-hidden"
                                  />
                                </div>

                                <div className="sm:col-span-3 flex items-center gap-2 pt-2 sm:pt-4">
                                  <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={wc.requires_weigh_in}
                                      onChange={(e) =>
                                        handleUpdateWeightClass(idx, 'requires_weigh_in', e.target.checked)
                                      }
                                      className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
                                    />
                                    <span>Require Weigh-In</span>
                                  </label>
                                </div>

                                <div className="sm:col-span-1 flex justify-end pt-2 sm:pt-4">
                                  {weightClasses.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveWeightClass(idx)}
                                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-900 rounded transition-colors"
                                      title="Remove weight class"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Arnis Event to Snapshot</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Configured Events List */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Configured Events ({events.length})
              </h4>
            </div>

            {events.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-slate-800 rounded-lg bg-slate-950/20 text-slate-500 text-xs">
                No events configured under this snapshot yet. Add at least one event before opening registrations.
              </div>
            ) : (
              <div className="space-y-2">
                {events.map((evt) => {
                  const evtWeightClasses = (evt.rules_override?.weight_classes as EventWeightClassItem[]) || [];
                  const isMixed = evt.gender === 'MIXED';

                  return (
                    <div
                      key={evt.id}
                      className="p-3 bg-slate-950/40 border border-slate-800 rounded-lg space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-slate-200">{evt.name}</div>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400">
                            <span className="px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded font-medium">
                              {evt.category}
                            </span>
                            <span>{evt.division}</span>
                            {isMixed && (
                              <span className="px-1.5 py-0.5 bg-purple-950/80 text-purple-300 border border-purple-800/60 rounded text-[10px] font-semibold">
                                Mixed Division
                              </span>
                            )}
                            {evt.gender && !isMixed && <span>• {evt.gender === 'M' ? 'Male' : 'Female'}</span>}
                            {evt.weight_class && <span>• {evt.weight_class}</span>}
                            {Boolean(evt.rules_override?.requires_weigh_in) && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 rounded">
                                Weigh-In
                              </span>
                            )}
                          </div>
                        </div>

                        {!isReadOnly && (
                          <button
                            onClick={() => handleDeleteEvent(evt.id)}
                            disabled={deletingId === evt.id}
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800/80 rounded transition-colors"
                            title="Remove event"
                          >
                            {deletingId === evt.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>

                      {/* Display configured weight classes breakdown if multiple exist */}
                      {evtWeightClasses.length > 0 && evt.weight_class !== 'Open Weight' && evt.weight_class !== 'N/A' && (
                        <div className="pt-2 border-t border-slate-900 flex flex-wrap gap-1.5">
                          {evtWeightClasses.map((w, wIdx) => (
                            <span
                              key={wIdx}
                              className="text-[11px] px-2 py-0.5 bg-slate-900 text-slate-300 border border-slate-800 rounded flex items-center gap-1.5"
                            >
                              <span className="font-semibold text-amber-300">{w.name}</span>
                              {(w.min_weight !== null || w.max_weight !== null) && (
                                <span className="text-[10px] text-slate-400">
                                  ({w.min_weight ?? 0}–{w.max_weight ?? '∞'} kg)
                                </span>
                              )}
                              {w.requires_weigh_in && (
                                <span className="text-[9px] text-emerald-400">✓ Weigh-In</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/40 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
