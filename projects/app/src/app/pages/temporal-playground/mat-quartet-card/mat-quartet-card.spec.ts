import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MatQuartetCard } from './mat-quartet-card';

describe('MatQuartetCard', () => {
  let component: MatQuartetCard;
  let fixture: ComponentFixture<MatQuartetCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatQuartetCard],
    }).compileComponents();

    fixture = TestBed.createComponent(MatQuartetCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
