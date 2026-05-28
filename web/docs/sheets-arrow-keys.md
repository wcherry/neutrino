In Neutrino Sheets I want the arrow keys to move around the sheet according to two modes:
1. Movement Mode
    i. Left arrow moves left one column
    ii. Right arrow moves right one column
    iii. Up arrow moves up one row
    iv. Down arrow moves down one row
    v. Arrow+Shift selects the current cell and the cell we move to
    vii. Right arrow + Ctrl moves to the last column in that row that has data
    viii.  Down arrow + Ctrl moves to the last row in that column that has data
    ix. Left arrow + Ctrl moves to the first column in that row that has data
    x. Up arrow + Ctrl moves to the first row in that colum that has data
    xi. Arrow + Ctrl + Shift selects all of the cells between the starting cell and the ending cell
2. Formula Mode:
    i. Arrow keys only perform their normal operation inside of a input box.
 
These are the rules that control the mode:
1. If the user clicks a cell: they are now in Movement Mode
2. If the user clicks in the formula bar input: they are in Formula Mode
3. If the user presses Enter they are moved to the next row and they enter Movement Mode
4. If the user presses Tab they are moved to the next column and they enter Movement Mode

## Notes:
No matter what mode I'm in, typing text needs to go to the formula input box. Pressing Enter still goes to the next row and Tab goes to the next column