import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DurationCard } from './duration-card';

describe('DurationCard', () => {
  let component: DurationCard;
  let fixture: ComponentFixture<DurationCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DurationCard],
    }).compileComponents();

    fixture = TestBed.createComponent(DurationCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
