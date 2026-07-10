import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimeCard } from './time-card';

describe('TimeCard', () => {
  let component: TimeCard;
  let fixture: ComponentFixture<TimeCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimeCard],
    }).compileComponents();

    fixture = TestBed.createComponent(TimeCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
