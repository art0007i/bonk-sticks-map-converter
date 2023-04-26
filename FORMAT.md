# the funny format

info dat parsed directly using nson cuz i dont give a shit
before that inject _customData for each difficulty saying like
1s beatdistance

# important part

diff files:
```
N,10,1,0,0,1
O,10,1,1,10,0
```

N-> note
    time,col,row,type,direction,angle

    type->
        0 -> RED
        1 -> BLUE
        2 -> unused
        3 -> BOMB

    direction ->
        0123: UDLR
        4: UL
        5: UR
        6: DL
        7: DR
        8: dot
    angle-> ccw angle offset

O-> obstacle
    time,col,row,width,height,duration

    row-> DIFFERENT THAN NOTES
        0: lowest base
        1: 2/3 base
        2: 1/2 base

    width-> who fucking knows I guess 1 is 1 lane? (int)
    height-> 1-5 who knows how much this is????
        apparently 5 is full height
        4 is equivalent to row 1
        3 is equivalent to row 2
        2 would be like smaller than 1 row ig
        1 is even smaller??



