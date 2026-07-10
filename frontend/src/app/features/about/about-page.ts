import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** "The Story of Marsad" — editorial page on the name and its inspiration. */
@Component({
  selector: 'app-about-page',
  imports: [RouterLink],
  templateUrl: './about-page.html',
  styleUrl: './about-page.scss',
})
export class AboutPage {}
