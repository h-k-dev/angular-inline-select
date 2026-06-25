import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularInlineText, normalizeString } from './angular-inline-text';

describe('AngularInlineText', () => {
  let component: AngularInlineText;
  let fixture: ComponentFixture<AngularInlineText>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AngularInlineText],
    }).compileComponents();

    fixture = TestBed.createComponent(AngularInlineText);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should normalize surplus whitespace and newlines', () => {
    expect(normalizeString('  hello \n  world  ')).toBe('hello world');
  });
});
