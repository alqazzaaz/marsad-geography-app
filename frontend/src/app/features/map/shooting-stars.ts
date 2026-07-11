import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';

import { ThemeService } from '../../core/services/theme.service';

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  life: number;
  maxLife: number;
}

/**
 * Ambient golden shooting stars around the globe — sparse, slow, premium.
 * A single canvas overlay (pointer-events: none); only visible in the night
 * theme, paused entirely when the user prefers reduced motion.
 */
@Component({
  selector: 'app-shooting-stars',
  template: '<canvas #canvas class="stars-canvas" aria-hidden="true"></canvas>',
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      display: block;
    }
    .stars-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
  `,
})
export class ShootingStars implements AfterViewInit {
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private stars: Star[] = [];
  private frame: number | null = null;
  private nextSpawn = 0;
  private running = false;

  constructor() {
    effect(() => {
      const night = this.themeService.theme() === 'night';
      if (night && !this.running) {
        this.start();
      } else if (!night) {
        this.stop();
      }
    });
    this.destroyRef.onDestroy(() => this.stop());
  }

  ngAfterViewInit(): void {
    if (this.themeService.theme() === 'night') {
      this.start();
    }
  }

  private start(): void {
    const canvas = this.canvasRef?.().nativeElement;
    if (!canvas || this.running) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    this.running = true;
    const ctx = canvas.getContext('2d')!;
    this.nextSpawn = performance.now() + 1200;

    const tick = (now: number) => {
      if (!this.running) {
        return;
      }
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      if (now >= this.nextSpawn && this.stars.length < 3) {
        this.stars.push(this.spawn(w, h));
        // Sparse and irregular: one streak every ~2.5-6s.
        this.nextSpawn = now + 2500 + Math.random() * 3500;
      }

      this.stars = this.stars.filter((s) => s.life < s.maxLife);
      for (const s of this.stars) {
        s.life += 16.7;
        s.x += s.vx;
        s.y += s.vy;
        // Ease alpha in fast, out slow.
        const t = s.life / s.maxLife;
        const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        const tailX = s.x - s.vx * s.len;
        const tailY = s.y - s.vy * s.len;
        const grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
        grad.addColorStop(0, `rgba(233, 208, 152, ${0.9 * alpha})`);
        grad.addColorStop(0.3, `rgba(201, 162, 75, ${0.45 * alpha})`);
        grad.addColorStop(1, 'rgba(201, 162, 75, 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        // Bright head.
        ctx.fillStyle = `rgba(244, 226, 181, ${alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }

      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stop(): void {
    this.running = false;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.stars = [];
    const canvas = this.canvasRef?.().nativeElement;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Spawn along the top/side edges, streaking diagonally across the sky. */
  private spawn(w: number, h: number): Star {
    const fromTop = Math.random() < 0.7;
    const speed = 2.6 + Math.random() * 2.2;
    const angle = fromTop
      ? Math.PI * (0.2 + Math.random() * 0.15) // down-right-ish
      : Math.PI * (0.05 + Math.random() * 0.1); // shallow, across
    const dir = Math.random() < 0.5 ? 1 : -1;
    const vx = Math.cos(angle) * speed * dir;
    const vy = Math.sin(angle) * speed;
    return {
      x: fromTop ? Math.random() * w : dir === 1 ? -20 : w + 20,
      y: fromTop ? -20 : Math.random() * h * 0.45,
      vx,
      vy,
      len: 14 + Math.random() * 12,
      life: 0,
      maxLife: 1400 + Math.random() * 900,
    };
  }
}
