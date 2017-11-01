import { FunctionAppContext, FunctionsService } from './../shared/services/functions-service';
import { Component, OnInit, Input } from '@angular/core';
import { FunctionAppEditMode } from '../shared/models/function-app-edit-mode';

@Component({
  selector: 'app-edit-mode-warning',
  templateUrl: './edit-mode-warning.component.html',
  styleUrls: ['./edit-mode-warning.component.scss']
})
export class EditModeWarningComponent implements OnInit {

  @Input() context: FunctionAppContext;

  public readOnly = false;
  public readOnlySourceControlled = false;
  public readWriteSourceControlled = false;
  public readOnlySlots = false;
  public ReadOnlyVSGenerated = false;

  constructor(private _functionsService: FunctionsService) { }

  ngOnInit() {
    if (this.context) {
      this._functionsService
        .getFunctionAppEditMode(this.context)
        .subscribe(editMode => {
          if (editMode === FunctionAppEditMode.ReadOnly) {
            this.readOnly = true;
          } else if (editMode === FunctionAppEditMode.ReadOnlySourceControlled) {
            this.readOnlySourceControlled = true;
          } else if (editMode === FunctionAppEditMode.ReadWriteSourceControlled) {
            this.readWriteSourceControlled = true;
          } else if (editMode === FunctionAppEditMode.ReadOnlySlots) {
            this.readOnlySlots = true;
          } else if (editMode === FunctionAppEditMode.ReadOnlyVSGenerated) {
            this.ReadOnlyVSGenerated = true;
          }
        });
    }
  }

  onFunctionAppSettingsClicked() {
    // TODO: FIX THIS!!!
  }
}
