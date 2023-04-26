# the funny format

info dat is just json, but stripped down from all data that is useless to us

and also the difficulty files are bundled into the modified info dat, this way everything is just 1 file

# important part

diff files are a newline separated array of objects:
```
N,10,1,0,0,1
O,10,1,1,10,0
```
(the newline has to be a single character `\n`!)

the first letter determines the type, and the following pieces of data are the objects properties, as listed below:

## Object Definitions

- N: note
  - **time,col,row,type,direction,angle**
    
  - type:
    - 0: RED
    - 1: BLUE
    - 2: unused
    - 3: BOMB

  - direction ->
    - 0123: UDLR
    - 4: UL
    - 5: UR
    - 6: DL
    - 7: DR
    - 8: dot
        
  - angle-> ccw angle offset

- O: obstacle
  - **time,col,row,width,height,duration**

  - row: DIFFERENT THAN NOTES
     - 0: lowest base
     - 1: 2/3 base
     - 2: 1/2 base

  - width: 1 is 1 lane
    
  - height: 1 is 1 lane, but keep in mind that they do start lower (look at row)


