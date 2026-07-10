import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MatTableCard } from './mat-table-card';

describe('MatTableCard', () => {
  let component: MatTableCard;
  let fixture: ComponentFixture<MatTableCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatTableCard],
    }).compileComponents();

    fixture = TestBed.createComponent(MatTableCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
