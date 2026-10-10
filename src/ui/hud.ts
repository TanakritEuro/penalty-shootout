import { TUNING } from '../config';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM overlay: status line, power meter, result banner and a running tally. */
export class Hud {
  private readonly status = el<HTMLDivElement>('status');
  private readonly tally = el<HTMLDivElement>('tally');
  private readonly result = el<HTMLDivElement>('result');
  private readonly resultTitle = el<HTMLDivElement>('result-title');
  private readonly resultDetail = el<HTMLDivElement>('result-detail');
  private readonly power = el<HTMLDivElement>('power');
  private readonly powerFill = el<HTMLDivElement>('power-fill');

  constructor() {
    el<HTMLDivElement>('power-danger').style.width = `${(1 - TUNING.shooting.overpowerThreshold) * 100}%`;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setTally(goals: number, shots: number): void {
    this.tally.textContent = `Goals ${goals} / ${shots}`;
  }

  /** Show the meter at `power` (0–1), or hide it with null. */
  setPower(power: number | null): void {
    this.power.classList.toggle('hidden', power === null);
    if (power === null) return;
    this.powerFill.style.width = `${power * 100}%`;
    this.powerFill.classList.toggle('over', power > TUNING.shooting.overpowerThreshold);
  }

  showResult(title: string, detail: string, isGoal: boolean): void {
    this.resultTitle.textContent = title;
    this.resultTitle.classList.toggle('goal', isGoal);
    this.resultDetail.textContent = detail;
    this.result.hidden = false;
  }

  hideResult(): void {
    this.result.hidden = true;
  }
}
